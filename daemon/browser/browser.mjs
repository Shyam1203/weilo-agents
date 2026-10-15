import { hostname } from "node:os";
import { createRequire } from "node:module";
import { abort, activityOf, prompt } from "../agents/runner.mjs";
import { fail } from "../common.mjs";
import {
  BACK_TIMEOUT_MS, CONNECT_TIMEOUT_MS, CONTENT_TIMEOUT_MS, ELEMENT_TIMEOUT_MS, LOAD_TIMEOUT_MS, PORT, SETTLE_MS, SNAPSHOT_MAX, SNAPSHOT_TIMEOUT_MS, TAB_TIMEOUT_MS, WINDOW_TRIES, WINDOW_TRY_MS,
} from "../config.mjs";
import { cdpAddress, hasScreen } from "./screen.mjs";

// What agents do in the browser. All agents share one Chromium (one profile, so one set of logins),
// and each agent has its own window with as many tabs as it wants: its tab group. An agent only
// ever sees and uses the tabs of its own window, which the browser's window id tells apart. The
// page is read as text, as Playwright's accessibility snapshot, in which each element has a ref
// ("e13") that click and type use. The user can take a window over: the agent stops and waits.

const playwright = () => createRequire(import.meta.url)("playwright-core"); // installed globally in the image (NODE_PATH)

const TAKEN = "The user is using this browser now. Wait until they give it back.";

// agent id -> { window: { windowId, tab: Page, known: how many tabs it had when last looked } or null,
// taken: undefined, or whether its run was stopped for the take-over, queue: the end of its steps, which run one after another }
const agents = new Map();
const of = (agent) => agents.get(agent) ?? agents.set(agent, { window: null, taken: undefined, queue: Promise.resolve() }).get(agent);

// --- The browser ---

let connecting;
const connected = () =>
  (connecting ??= connect().catch((err) => {
    connecting = undefined;
    throw err;
  }));

async function connect() {
  if (!hasScreen()) throw fail(409, "This image has no browser");
  const browser = await playwright().chromium.connectOverCDP(cdpAddress(PORT), { timeout: CONNECT_TIMEOUT_MS });
  browser.on("disconnected", () => {
    connecting = undefined;
    for (const record of agents.values()) record.window = null;
  });
  return { ctx: browser.contexts()[0], root: await browser.newBrowserCDPSession() };
}

// The app's address: agents may not open it in the browser. Chromium blocks it too, for a redirect
// (image/chromium-policy.json); this gives the agent a clear message.
const OWN_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0", "[::]", hostname().toLowerCase()]);
const isOwn = (url) => {
  const { hostname: host, port, protocol } = url instanceof URL ? url : new URL(url);
  return /^https?:$/.test(protocol) && (OWN_HOSTS.has(host.toLowerCase()) || host.toLowerCase().startsWith("127.")) && port === String(PORT);
};

// Which window a page is in: the browser's ids, asked once per page.
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

// The tabs in a window, in the order they opened.
async function tabsOf(w) {
  const c = await connected();
  const pages = c.ctx.pages().filter((page) => !page.isClosed());
  const ids = await Promise.all(pages.map((page) => windowIdOf(c, page).catch(() => null)));
  return pages.filter((_, i) => ids[i]?.windowId === w.windowId);
}

// The agent's window and its tabs; null when it has none (it was never opened, or you closed it).
async function live(agent) {
  const record = of(agent);
  const w = record.window;
  if (!w) return null;
  const tabs = await tabsOf(w);
  if (!tabs.length) {
    record.window = null;
    return null;
  }
  if (!tabs.includes(w.tab)) w.tab = tabs.at(-1);
  return { w, tabs };
}

// The window fills the screen (maximized: no border or gap). One you minimized or resized comes back (the screen has no taskbar to find it).
async function restore({ windowId }) {
  const { root } = await connected();
  const { bounds } = await root.send("Browser.getWindowBounds", { windowId });
  if (bounds.windowState === "maximized") return;
  // A minimized window has to become normal first.
  await root.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
  await root.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "maximized" } });
}

export const hasWindow = async (agent) => Boolean(await live(agent).catch(() => null));

/** Brings the agent's window to the front of the screen, if it has one. */
export async function showBrowser(agent) {
  const state = await live(agent);
  if (!state) return;
  await restore(state.w).catch(() => {});
  await state.w.tab.bringToFront();
}

// A new window for the agent. Its first tab is found by the browser's id for it.
async function openWindow(agent) {
  const c = await connected();
  const { targetId } = await c.root.send("Target.createTarget", { url: "about:blank", newWindow: true });
  const { windowId } = await c.root.send("Browser.getWindowForTarget", { targetId });
  const tab = await pageFor(c, targetId);
  const w = { windowId, tab, known: 1 };
  await restore(w).catch(() => {});
  of(agent).window = w;
  // A new window comes up in front; a window you took over stays there.
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

// A new tab in the agent's own window, opened from a tab it already has.
async function openTab(w) {
  const [popup] = await Promise.all([w.tab.waitForEvent("popup", { timeout: TAB_TIMEOUT_MS }), w.tab.evaluate(() => window.open("about:blank", "_blank"))]);
  w.tab = popup;
  return popup;
}

// --- A step ---

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

// What the agent sees after a step: where it is, and the page as text.
async function view(w) {
  const tabs = await tabsOf(w);
  const { tab } = w;
  await tab.waitForLoadState("domcontentloaded", { timeout: CONTENT_TIMEOUT_MS }).catch(() => {});
  await tab.waitForTimeout(SETTLE_MS);
  let text = await tab.locator("body").ariaSnapshot({ mode: "ai", timeout: SNAPSHOT_TIMEOUT_MS }).catch(() => "(The page has nothing to read.)");
  if (text.length > SNAPSHOT_MAX) text = `${text.slice(0, SNAPSHOT_MAX)}\n(The page is longer. Scroll down to read more.)`;
  // A page can open a tab by itself (a link that opens a new tab).
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
  else state = { w: await openWindow(agent) };
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
      // The last tab stays: the window is the agent's place.
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

// The browser's own errors (an element that is gone, a page that does not load) become a message for the agent.
function asMessage(err) {
  if (err.status) throw err;
  // A ref that timed out is an element the page no longer has.
  throw fail(409, err.name === "TimeoutError" && /^locator\./.test(err.message) ? "That element is not on the page. Use read to see the page again." : String(err.message).split("\n")[0]);
}

/**
 * One step in an agent's browser: `args.action` is open, read, click, type, press, scroll, back,
 * new_tab, tabs, switch or close_tab. Returns what the agent sees next, as text. An agent's steps
 * run one after another.
 */
export function useBrowser(agent, args) {
  const record = of(agent);
  const result = record.queue.then(() => step(agent, args)).catch(asMessage);
  record.queue = result.catch(() => {});
  return result;
}

// --- Take over ---

export const isTaken = (agent) => agents.get(agent)?.taken !== undefined;

/**
 * You use the agent's window: its run stops, and its browser steps are refused until you give it
 * back. The window opens if it has none.
 */
export async function takeOver(agent) {
  if (isTaken(agent)) return;
  const record = of(agent);
  const busy = activityOf(agent) !== null;
  record.taken = busy;
  try {
    if (busy) await abort(agent);
    // A step that was running finishes first.
    await record.queue;
    if (!(await live(agent))) await openWindow(agent);
    await showBrowser(agent);
  } catch (err) {
    record.taken = undefined;
    throw err;
  }
}

/** The agent may use its window again, and carries on if you stopped its run. */
export async function giveBack(agent) {
  const record = of(agent);
  const carryOn = record.taken;
  record.taken = undefined;
  if (carryOn) await prompt(agent, { text: "I finished using the browser. Read the page again, then carry on." });
}

/** Closes the agent's window (the agent is deleted). */
export async function closeBrowser(agent) {
  // A step that is running ends first, so it cannot open the window again.
  await of(agent).queue;
  const state = await live(agent).catch(() => null);
  agents.delete(agent);
  await Promise.all((state?.tabs ?? []).map((tab) => tab.close().catch(() => {})));
}
