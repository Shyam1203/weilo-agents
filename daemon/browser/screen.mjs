import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { BIN, MAX_VIEW_MESSAGE, SCREEN, SCREEN_RESTART_MS } from "../config.mjs";
import { accept, frame, readMessages } from "../http/websocket.mjs";
import { BROWSER, folder, setOwner, spawnAs } from "../users.mjs";

// The browser's screen: a virtual display (Xvnc) with a window manager and one Chromium, all as the browser's own user
// (users.mjs). The daemon starts them and starts them again if they stop. Nothing else in the container can reach them:
// - the display's VNC socket is in a folder of that user's alone; the user's browser sees it through the daemon's own
//   port, for paired devices (`viewUpgrade`).
// - the display takes X clients with its secret cookie only (in the same folder), so an agent cannot type into the browser.
// - Chromium has no debugging port: the daemon drives it over a pipe (`--remote-debugging-pipe`), and Playwright reaches
//   that pipe through the daemon's own port with a secret path (`cdpUpgrade`).

const DISPLAY = ":1";
const PRIVATE = "/tmp/weilo-screen";
const SOCKET = join(PRIVATE, "vnc.sock");
const XAUTHORITY = join(PRIVATE, "Xauthority");
// Chromium's profile (logins, cookies) lives in a volume: a profile on a Windows bind mount can't lock its files.
const PROFILE = "/home/node/.browser";
const ENV = { ...process.env, DISPLAY, XAUTHORITY, HOME: "/home/node" };

const log = (...args) => console.log("[screen]", ...args);

// Keeps a program running. A program that is missing means the image has no screen (a dev run): skip it.
function keep(name, command, args, { delay = 0, stdio = "ignore", started } = {}) {
  const run = () => {
    const child = spawnAs(BROWSER, command, args, { stdio, env: ENV });
    child.on("error", () => log(`${name} cannot start`));
    child.on("exit", (code) => {
      log(`${name} exited (${code}); starting again in ${SCREEN_RESTART_MS / 1000}s`);
      setTimeout(run, SCREEN_RESTART_MS).unref();
    });
    started?.(child);
  };
  setTimeout(run, delay).unref();
}

export const hasScreen = () => existsSync(BIN.Xvnc) && existsSync(BIN.chromium);

// An Xauthority file with one cookie for any host's display 1 (FamilyWild).
function xauthority(cookie) {
  const field = (data) => Buffer.concat([Buffer.from([data.length >> 8, data.length & 255]), data]);
  return Buffer.concat([Buffer.from([0xff, 0xff]), field(Buffer.alloc(0)), field(Buffer.from("1")), field(Buffer.from("MIT-MAGIC-COOKIE-1")), field(cookie)]);
}

export async function startScreen() {
  if (!hasScreen()) return log("not in this image; the browser is off");
  // After a restart the old display and browser leave their lock files behind.
  rmSync("/tmp/.X1-lock", { force: true });
  rmSync("/tmp/.X11-unix/X1", { force: true });
  rmSync(PRIVATE, { recursive: true, force: true });
  for (const file of existsSync(PROFILE) ? readdirSync(PROFILE).filter((f) => f.startsWith("Singleton")) : []) rmSync(join(PROFILE, file), { force: true });
  await folder(PRIVATE, BROWSER.uid, BROWSER.gid, 0o700);
  writeFileSync(XAUTHORITY, xauthority(randomBytes(16)), { mode: 0o600 });
  await setOwner(XAUTHORITY, BROWSER.uid, BROWSER.gid, 0o600);

  keep("display", BIN.Xvnc, [DISPLAY, "-auth", XAUTHORITY, "-geometry", `${SCREEN.width}x${SCREEN.height}`, "-depth", "24", "-SecurityTypes", "None", "-rfbunixpath", SOCKET, "-rfbport", "-1", "-nolisten", "tcp"]);
  keep("windows", BIN.openbox, [], { delay: 1000 });
  keep(
    "browser",
    BIN.chromium,
    [
      "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-crash-restore-bubble",
      // A window behind another keeps working: agents use their own windows at the same time.
      "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
      // Private by default: no sync, component updates or other background calls to Google.
      "--test-type", "--disable-background-networking", "--disable-sync", "--disable-component-update", "--no-pings", "--disable-domain-reliability",
      "--disable-features=CalculateNativeWinOcclusion,OptimizationHints,MediaRouter,Translate,PushMessaging",
      "--host-resolver-rules=MAP android.clients.google.com ~NOTFOUND, MAP mtalk.google.com ~NOTFOUND",
      `--user-data-dir=${PROFILE}`, "--remote-debugging-pipe",
      "--start-maximized", "about:blank",
    ],
    // fd 3: what Chromium reads (commands), fd 4: what it writes (answers and events).
    { delay: 2000, stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], started: attachPipe },
  );
}

// --- The live view: a WebSocket to the screen ---
// noVNC in the user's browser speaks VNC in binary WebSocket messages. The display speaks plain
// VNC on its unix socket. This turns one into the other.

/**
 * Passes a WebSocket upgrade from the user's browser to the screen. The caller has already checked
 * who is asking. Returns false when this is not a WebSocket request or the screen is off.
 */
export function viewUpgrade(req, socket, head) {
  if (!hasScreen() || !accept(req, socket, "binary")) return false;
  const screen = connect(SOCKET);
  // Node drops its error handler on upgrade: a client that resets would crash the daemon.
  const end = () => (screen.destroy(), socket.destroy());
  screen.on("error", end);
  socket.on("error", end);
  socket.on("close", end);
  screen.on("close", end);
  // A slow viewer holds the screen back instead of filling the daemon's memory.
  screen.on("data", (data) => {
    if (!socket.write(frame(data))) {
      screen.pause();
      socket.once("drain", () => screen.resume());
    }
  });
  readMessages(socket, head, MAX_VIEW_MESSAGE, (data) => screen.write(data), end);
  return true;
}

// --- Chromium's debugging channel ---
// Chromium reads and writes messages of JSON ended by a NUL on its pipe. Playwright speaks the same JSON over a
// WebSocket: the daemon's own port, at a path with a secret made at start (`cdpAddress`), for the daemon's own Playwright.

const SECRET = randomBytes(24).toString("hex");
let chromium = null; // { write(text) } of the Chromium running now
let client = null; // the WebSocket Playwright is connected with

export const cdpAddress = (port) => `ws://127.0.0.1:${port}/api/browser-cdp/${SECRET}`;
export const isCdpPath = (path) => path === `/api/browser-cdp/${SECRET}`;

function attachPipe(child) {
  const [, , , input, output] = child.stdio;
  input.on("error", () => {});
  chromium = { write: (text) => input.write(`${text}\0`) };
  let pending = "";
  output.setEncoding("utf8").on("data", (chunk) => {
    const messages = (pending + chunk).split("\0");
    pending = messages.pop();
    for (const message of messages) client?.write(frame(Buffer.from(message), 0x1));
  });
  // A new Chromium is a new browser: Playwright connects again.
  child.on("exit", () => {
    chromium = null;
    client?.destroy();
  });
}

// One Playwright at a time; the caller has checked the path.
export function cdpUpgrade(req, socket, head) {
  if (!chromium || !accept(req, socket)) return false;
  client?.destroy();
  client = socket;
  const end = () => {
    socket.destroy();
    if (client === socket) client = null;
  };
  socket.on("error", end);
  socket.on("close", end);
  readMessages(socket, head, 64 * 2 ** 20, (data) => chromium?.write(data.toString("utf8")), end);
  return true;
}
