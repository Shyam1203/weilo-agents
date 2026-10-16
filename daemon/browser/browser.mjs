import { hostname } from "node:os";
import { createRequire } from "node:module";
import { abort, activityOf, prompt } from "../agents/runner.mjs";
import { fail } from "../common.mjs";
import {
  BROWSER_IDLE_MS, BROWSER_SWEEP_MS, WINDOW_IDLE_MS, BACK_TIMEOUT_MS, CONNECT_TIMEOUT_MS, CONTENT_TIMEOUT_MS, ELEMENT_TIMEOUT_MS, LOAD_TIMEOUT_MS, PORT, SETTLE_MS, SNAPSHOT_MAX, SNAPSHOT_TIMEOUT_MS, TAB_TIMEOUT_MS, WINDOW_TRIES, WINDOW_TRY_MS,
} from "../config.mjs";
import { tellAgent } from "../agents/status.mjs";
import { cdpAddress, hasScreen, isAwake, sleepScreen, viewing, wakeScreen } from "./screen.mjs";

const playwright = () => createRequire(import.meta.url)("playwright-core");

const TAKEN = "The user is using this browser now. Wait until they give it back.";

const agents = new Map();
const of = (agent) => agents.get(agent) ?? agents.set(agent, { window: null, taken: undefined, queue: Promise.resolve(), used: Date.now() }).get(agent);

let connecting;
let current = null;
const forgetWindows = () => {
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
    if (current !== browser) return;
    current = null;
    connecting = undefined;
    forgetWindows();
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

// Tabs an agent left open keep running (the browser does not slow down background tabs, so that
// agents can work in them). When an agent has not used its window for a while and is not working,
// its window is closed; when nothing uses the browser at all, it sleeps until the next use.
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
  current = null;
  connecting = undefined;
  forgetWindows();
}

let sweeping = false;
setInterval(() => {
  if (sweeping) return;
  sweeping = true;
  void sweep()
    .catch((err) => console.error("Browser:", err.message))
    .finally(() => (sweeping = false));
}, BROWSER_SWEEP_MS).unref();
