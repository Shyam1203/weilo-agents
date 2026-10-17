import { hostname } from "node:os";
import { createRequire } from "node:module";
import { abort, activityOf, prompt } from "../agents/runner.mjs";
import { fail, unsafe } from "../common.mjs";
import {
  BROWSER_IDLE_MS, BROWSER_SWEEP_MS, MAX_TEACH_GOAL, MAX_TEACH_STEPS, WINDOW_IDLE_MS, BACK_TIMEOUT_MS, CONNECT_TIMEOUT_MS, CONTENT_TIMEOUT_MS, ELEMENT_TIMEOUT_MS, LOAD_TIMEOUT_MS, PORT, SETTLE_MS, SNAPSHOT_MAX, SNAPSHOT_TIMEOUT_MS, TAB_TIMEOUT_MS, WINDOW_TRIES, WINDOW_TRY_MS,
} from "../config.mjs";
import { tellAgent } from "../agents/status.mjs";
import { cdpAddress, hasScreen, isAwake, sleepScreen, viewing, wakeScreen } from "./screen.mjs";

const playwright = () => createRequire(import.meta.url)("playwright-core");

const TAKEN = "The user is using this browser now. Wait until they give it back.";

const agents = new Map();
const of = (agent) => agents.get(agent) ?? agents.set(agent, { window: null, taken: undefined, queue: Promise.resolve(), used: Date.now() }).get(agent);

let connecting;
let current = null;
const forget = () => {
  current = null;
  connecting = undefined;
  for (const [agent, record] of agents) if (record.window) (record.window = null), tellAgent(agent, { browserOpen: false });
};
const connected = () =>
  (connecting ??= connect().catch((err) => {
    connecting = undefined;
    throw err;
  }));

async function connect() {
  if (!hasScreen()) throw fail(409, "This image has no browser");
  await wakeScreen();
  const browser = await playwright().chromium.connectOverCDP(cdpAddress(PORT), { timeout: CONNECT_TIMEOUT_MS });
  current = browser;
  browser.on("disconnected", () => {
    if (current === browser) forget();
  });
  return { ctx: browser.contexts()[0], root: await browser.newBrowserCDPSession() };
}

const OWN_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0", "[::]", hostname().toLowerCase()]);
const isOwn = (url) => {
  const { hostname: host, port, protocol } = url instanceof URL ? url : new URL(url);
  return /^https?:$/.test(protocol) && (OWN_HOSTS.has(host.toLowerCase()) || host.toLowerCase().startsWith("127.")) && port === String(PORT);
};

const where = new WeakMap();
function windowIdOf(c, page) {
  if (!where.has(page)) {
    where.set(
      page,
      (async () => {
        const session = await c.ctx.newCDPSession(page);
        try {
          const { targetId } = (await session.send("Target.getTargetInfo")).targetInfo;
          return { targetId, windowId: (await c.root.send("Browser.getWindowForTarget", { targetId })).windowId };
        } finally {
          await session.detach().catch(() => {});
        }
      })().catch((err) => {
        where.delete(page);
        throw err;
      }),
    );
  }
  return where.get(page);
}

async function tabsOf(w) {
  const c = await connected();
  const pages = c.ctx.pages().filter((page) => !page.isClosed());
  const ids = await Promise.all(pages.map((page) => windowIdOf(c, page).catch(() => null)));
  return pages.filter((_, i) => ids[i]?.windowId === w.windowId);
}

async function live(agent) {
  const record = of(agent);
  const w = record.window;
  if (!w) return null;
  const tabs = await tabsOf(w);
  if (!tabs.length) {
    record.window = null;
    tellAgent(agent, { browserOpen: false });
    return null;
  }
  if (!tabs.includes(w.tab)) w.tab = tabs.at(-1);
  return { w, tabs };
}

async function restore({ windowId }) {
  const { root } = await connected();
  const { bounds } = await root.send("Browser.getWindowBounds", { windowId });
  if (bounds.windowState === "maximized") return;
  await root.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
  await root.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "maximized" } });
}

export const hasWindow = async (agent) => Boolean(await live(agent).catch(() => null));

export async function showBrowser(agent) {
  const state = await live(agent);
  if (!state) return;
  await restore(state.w).catch(() => {});
  await state.w.tab.bringToFront();
}

async function openWindow(agent) {
  const c = await connected();
  const { targetId } = await c.root.send("Target.createTarget", { url: "about:blank", newWindow: true });
  const { windowId } = await c.root.send("Browser.getWindowForTarget", { targetId });
  const tab = await pageFor(c, targetId);
  const w = { windowId, tab, known: 1 };
  await restore(w).catch(() => {});
  of(agent).window = w;
  tellAgent(agent, { browserOpen: true });
  for (const [other, { taken }] of agents) if (other !== agent && taken !== undefined) await showBrowser(other).catch(() => {});
  return w;
}

async function pageFor(c, targetId) {
  for (let tries = 0; tries < WINDOW_TRIES; tries++) {
    for (const page of c.ctx.pages()) if ((await windowIdOf(c, page).catch(() => null))?.targetId === targetId) return page;
    await new Promise((resolve) => setTimeout(resolve, WINDOW_TRY_MS));
  }
  throw fail(409, "The browser window did not open");
}

async function openTab(w) {
  const [popup] = await Promise.all([w.tab.waitForEvent("popup", { timeout: TAB_TIMEOUT_MS }), w.tab.evaluate(() => window.open("about:blank", "_blank"))]);
  w.tab = popup;
  return popup;
}

const web = (url) => {
  if (!/^https?:\/\//i.test(String(url ?? ""))) throw fail(400, "Give a web address that starts with http:// or https://");
  if (isOwn(new URL(url))) throw fail(400, "You cannot open that address. It is part of this app.");
  return String(url);
};

const element = (tab, ref) => {
  if (!/^(f\d+)?e\d+$/.test(String(ref ?? ""))) throw fail(400, "Give the ref of an element, like e13");
  return tab.locator(`aria-ref=${ref}`);
};

const tabList = async ({ w, tabs }) => (await Promise.all(tabs.map(async (t, i) => `${i + 1}. ${t === w.tab ? "(this one) " : ""}${(await t.title()) || "(no title)"}: ${t.url()}`))).join("\n");

async function view(w) {
  const tabs = await tabsOf(w);
  const { tab } = w;
  await tab.waitForLoadState("domcontentloaded", { timeout: CONTENT_TIMEOUT_MS }).catch(() => {});
  await tab.waitForTimeout(SETTLE_MS);
  let text = await tab.locator("body").ariaSnapshot({ mode: "ai", timeout: SNAPSHOT_TIMEOUT_MS }).catch(() => "(The page has nothing to read.)");
  if (text.length > SNAPSHOT_MAX) text = `${text.slice(0, SNAPSHOT_MAX)}\n(The page is longer. Scroll down to read more.)`;
  const opened = tabs.length - w.known;
  w.known = tabs.length;
  const note = opened > 0 ? `\n(${opened === 1 ? "A new tab opened" : `${opened} new tabs opened`}. Use tabs and switch to read ${opened === 1 ? "it" : "them"}.)` : "";
  return `Tab ${tabs.indexOf(tab) + 1} of ${tabs.length}: ${(await tab.title()) || "(no title)"}\n${tab.url()}${note}\n\n${text}`;
}

async function step(agent, args) {
  if (isTaken(agent)) throw fail(409, TAKEN);
  const { action } = args;
  let state = await live(agent);
  if (action === "tabs") return state ? tabList(state) : "No tabs open.";
  if (state) await restore(state.w).catch(() => {});
  else state = { w: await openWindow(agent), tabs: [] };
  const { w } = state;
  const { tab } = w;
  switch (action) {
    case "open":
      await tab.goto(web(args.url), { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS });
      break;
    case "new_tab": {
      const next = await openTab(w);
      w.known = (await tabsOf(w)).length;
      if (args.url) await next.goto(web(args.url), { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT_MS });
      break;
    }
    case "switch": {
      const next = (await tabsOf(w))[Number(args.tab) - 1];
      if (!next) throw fail(400, `There is no tab ${args.tab}. Use tabs to see them.`);
      w.tab = next;
      await next.bringToFront();
      break;
    }
    case "close_tab": {
      const tabs = await tabsOf(w);
      const gone = args.tab ? tabs[Number(args.tab) - 1] : tab;
      if (!gone) throw fail(400, `There is no tab ${args.tab}. Use tabs to see them.`);
      if (tabs.length === 1) throw fail(400, "This is your only tab. Use open to go to another page.");
      await gone.close();
      w.known = tabs.length - 1;
      if (gone === tab) w.tab = tabs.filter((t) => t !== gone).at(-1);
      break;
    }
    case "read":
      break;
    case "click":
      await element(tab, args.ref).click({ timeout: ELEMENT_TIMEOUT_MS });
      break;
    case "type":
      await element(tab, args.ref).fill(String(args.text ?? ""), { timeout: ELEMENT_TIMEOUT_MS });
      if (args.submit) await tab.keyboard.press("Enter");
      break;
    case "press":
      await tab.keyboard.press(String(args.key ?? ""));
      break;
    case "scroll":
      await tab.evaluate((down) => window.scrollBy(0, (down ? 1 : -1) * Math.round(window.innerHeight * 0.8)), args.direction !== "up");
      break;
    case "back":
      await tab.goBack({ waitUntil: "domcontentloaded", timeout: BACK_TIMEOUT_MS });
      break;
    default:
      throw fail(400, "Unknown action");
  }
  return view(w);
}

function asMessage(err) {
  if (err.status) throw err;
  throw fail(409, err.name === "TimeoutError" && /^locator\./.test(err.message) ? "That element is not on the page. Use read to see the page again." : String(err.message).split("\n")[0]);
}

export function useBrowser(agent, args) {
  const record = of(agent);
  record.used = Date.now();
  const result = record.queue.then(() => step(agent, args)).catch(asMessage).finally(() => (record.used = Date.now()));
  record.queue = result.catch(() => {});
  return result;
}

export const isTaken = (agent) => agents.get(agent)?.taken !== undefined;
export const windowOpen = (agent) => Boolean(agents.get(agent)?.window);

export async function takeOver(agent) {
  if (isTaken(agent)) return;
  const record = of(agent);
  record.used = Date.now();
  const busy = activityOf(agent) !== null;
  record.taken = busy;
  try {
    if (busy) await abort(agent);
    await record.queue;
    if (!(await live(agent))) await openWindow(agent);
    await showBrowser(agent);
    tellAgent(agent, { taken: true });
  } catch (err) {
    record.taken = undefined;
    throw err;
  }
}

export async function giveBack(agent) {
  const record = of(agent);
  await stopTeaching(record);
  record.used = Date.now();
  const carryOn = record.taken;
  record.taken = undefined;
  tellAgent(agent, { taken: false });
  if (carryOn) await prompt(agent, { text: "I finished using the browser. Read the page again, then carry on." });
}

export async function closeBrowser(agent) {
  await of(agent).queue;
  const state = await live(agent).catch(() => null);
  agents.delete(agent);
  await Promise.all((state?.tabs ?? []).map((tab) => tab.close().catch(() => {})));
}

let lastUse = Date.now();
async function sweep() {
  if (!isAwake()) return;
  const now = Date.now();
  const watched = viewing();
  if (watched) lastUse = now;
  for (const [agent, record] of agents) {
    const idle = !watched && record.taken === undefined && activityOf(agent) === null && now - record.used > WINDOW_IDLE_MS;
    if (!idle || !record.window) continue;
    await record.queue;
    if (Date.now() - record.used <= WINDOW_IDLE_MS || record.taken !== undefined) continue;
    const state = await live(agent).catch(() => null);
    record.window = null;
    tellAgent(agent, { browserOpen: false });
    await Promise.all((state?.tabs ?? []).map((tab) => tab.close().catch(() => {})));
  }
  const records = [...agents.values()];
  const last = Math.max(lastUse, ...records.map((r) => r.used));
  if (Date.now() - last <= BROWSER_IDLE_MS || records.some((r) => r.taken !== undefined)) return;
  sleepScreen();
  forget();
}

let sweeping = false;
setInterval(() => {
  if (sweeping) return;
  sweeping = true;
  void sweep()
    .catch((err) => console.error("Browser:", err.message))
    .finally(() => (sweeping = false));
}, BROWSER_SWEEP_MS).unref();

const TEACH_BINDING = "__weiloTeach";
const RECORDER = `(() => {
  if (window.__weiloTeaching) return;
  window.__weiloTeaching = true;
  const send = (step) => { try { window.${TEACH_BINDING}(JSON.stringify(step)); } catch {} };
  const clean = (t) => String(t ?? "").replace(/\\s+/g, " ").trim().slice(0, 80);
  const labelOf = (el) => clean(el.getAttribute("aria-label") || (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || el.getAttribute("alt"));
  const nameOf = (el) => labelOf(el) || clean(el.innerText || el.value);
  const hidden = (el) => el.type === "password" || /cc-|one-time-code|password/.test(el.autocomplete || "");
  const valueOf = (el) => (hidden(el) ? null : clean(el.value));
  addEventListener("click", (e) => {
    const el = e.target.closest && e.target.closest("a,button,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],input[type=checkbox],input[type=radio],input[type=submit],input[type=button]");
    if (!el) return;
    const role = el.getAttribute("role");
    const kind = el.tagName === "A" || role === "link" ? "link" : el.type === "checkbox" || el.type === "radio" || role === "checkbox" ? "box" : "button";
    send({ act: "click", kind, name: nameOf(el) });
  }, true);
  addEventListener("change", (e) => {
    const el = e.target;
    if (el.tagName === "SELECT") return send({ act: "choose", field: labelOf(el), value: clean(el.selectedOptions && el.selectedOptions[0] && el.selectedOptions[0].text) });
    if (!/^(INPUT|TEXTAREA)$/.test(el.tagName) || /^(checkbox|radio|submit|button|file|hidden)$/.test(el.type)) return;
    send({ act: "type", field: labelOf(el), value: valueOf(el) });
  }, true);
  addEventListener("keydown", (e) => {
    const el = e.target;
    if (e.key === "Enter" && /^(INPUT|TEXTAREA)$/.test(el.tagName)) send({ act: "enter", field: labelOf(el), value: valueOf(el) });
  }, true);
})()`;

const quoted = (text) => `"${text}"`;
const fieldOf = (field) => (field ? ` in ${quoted(field)}` : "");
const textOf = (value) => (typeof value === "string" ? value.slice(0, 200) : "");

export function teachStep(step) {
  const [name, field] = [textOf(step.name), textOf(step.field)];
  const value = step.value === null ? null : textOf(step.value);
  const typed = value === null || unsafe(value) === "secret" ? `a password or other secret (not recorded)${fieldOf(field)}` : `${quoted(value)}${fieldOf(field)}`;
  switch (step.act) {
    case "open": {
      const url = textOf(step.url);
      return /^https?:/.test(url) ? `Opened ${url}` : null;
    }
    case "click":
      return !name ? null : step.kind === "link" ? `Clicked the link ${quoted(name)}` : step.kind === "box" ? `Ticked ${quoted(name)}` : `Clicked ${quoted(name)}`;
    case "type":
      return value === "" ? null : `Typed ${typed}`;
    case "choose":
      return value ? `Chose ${quoted(value)}${fieldOf(field)}` : null;
    case "enter":
      return value === "" ? `Pressed Enter${fieldOf(field)}` : `Typed ${typed} and pressed Enter`;
    default:
      return null;
  }
}

export function addStep(steps, step) {
  const line = teachStep(step);
  const last = steps.at(-1);
  if (!line || line === last || (step.act === "type" && last === `${line} and pressed Enter`)) return;
  if ((step.act === "enter" && last && line === `${last} and pressed Enter`) || (step.act === "open" && last?.startsWith("Opened "))) steps[steps.length - 1] = line;
  else if (steps.length < MAX_TEACH_STEPS) steps.push(line);
}

const taught = new WeakSet();
const recordingOf = (page) => [...agents.values()].map((r) => r.teach).find((t) => t?.pages.some((p) => p.page === page));

async function watchTab(teach, page) {
  if (teach.stopped || teach.pages.some((p) => p.page === page)) return;
  const note = (step) => !teach.stopped && addStep(teach.steps, step);
  const onNav = (frame) => frame === page.mainFrame() && note({ act: "open", url: frame.url() });
  teach.pages.push({ page, onNav });
  if (!taught.has(page)) {
    taught.add(page);
    await page.exposeBinding(TEACH_BINDING, ({ page: from }, payload) => {
      const now = recordingOf(from);
      try {
        const step = JSON.parse(String(payload));
        if (now && step && typeof step === "object" && step.act !== "open") addStep(now.steps, step);
      } catch {}
    });
    await page.addInitScript(RECORDER);
  }
  await page.evaluate(RECORDER).catch(() => {});
  page.on("framenavigated", onNav);
  note({ act: "open", url: page.url() });
}

const unwatch = ({ page, onNav }) => page.off("framenavigated", onNav);

async function stopTeaching(record) {
  const teach = record.teach;
  if (!teach) return [];
  record.teach = null;
  teach.stopped = true;
  teach.ctx?.off("page", teach.onTab);
  teach.pages.forEach(unwatch);
  return teach.steps;
}

export const teachingSteps = (agent) => agents.get(agent)?.teach?.steps.length ?? null;

export async function startTeaching(agent) {
  await takeOver(agent);
  const record = of(agent);
  if (record.teach) return;
  const teach = { steps: [], pages: [], stopped: false, ctx: null, onTab: null };
  record.teach = teach;
  try {
    const c = await connected();
    const state = await live(agent);
    teach.ctx = c.ctx;
    teach.onTab = (page) => void windowIdOf(c, page).then((id) => id?.windowId === record.window?.windowId && watchTab(teach, page)).catch(() => {});
    c.ctx.on("page", teach.onTab);
    for (const page of state?.tabs ?? []) await watchTab(teach, page);
  } catch (err) {
    await stopTeaching(record);
    throw err;
  }
}

export const teachMessage = (goal, steps) =>
  `I showed you in the browser how to: ${goal}\n\nWhat I did:\n${steps.map((step, i) => `${i + 1}. ${step}`).join("\n")}\n\nSave this as a skill with the skill tool, so you can do it yourself next time. Write the steps so they still work when the page changes a little, say which values change each time (like amounts or dates) and ask me for those then, and leave out what was only for this once. I did not record passwords: never ask me for one in the chat.`;

export async function finishTeaching(agent, goal) {
  const what = typeof goal === "string" ? goal.trim() : "";
  if (!what) throw fail(400, "Say in a few words what you showed");
  if (what.length > MAX_TEACH_GOAL) throw fail(400, `Say it in at most ${MAX_TEACH_GOAL} characters`);
  const record = of(agent);
  if (!record.teach) throw fail(409, "Nothing is being recorded");
  if (!record.teach.steps.some((step) => !step.startsWith("Opened "))) throw fail(400, "Nothing was recorded yet. Do the task in the browser, then click Done.");
  const steps = await stopTeaching(record);
  record.taken = undefined;
  tellAgent(agent, { taken: false });
  await prompt(agent, { text: teachMessage(what, steps) });
}
