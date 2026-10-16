import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { BIN, MAX_VIEW_MESSAGE, SCREEN, SCREEN_RESTART_MS, SCREEN_WAKE_MS } from "../config.mjs";
import { splitOn } from "../common.mjs";
import { accept, frame, readMessages } from "../http/websocket.mjs";
import { BROWSER, folder, setOwner, spawnAs } from "../users.mjs";

const DISPLAY = ":1";
const PRIVATE = "/tmp/weilo-screen";
const SOCKET = join(PRIVATE, "vnc.sock");
const XAUTHORITY = join(PRIVATE, "Xauthority");
const PROFILE = "/home/node/.browser";
const ENV = { ...process.env, DISPLAY, XAUTHORITY, HOME: "/home/node" };

const log = (...args) => console.log("[screen]", ...args);

// The screen runs from its first use until it sleeps (see sleepScreen). Each start is a new
// generation: a program of an earlier one that exits late is not started again.
let generation = 0;
const children = new Set();

function keep(name, command, args, { delay = 0, stdio = "ignore", started } = /** @type {{ delay?: number, stdio?: any, started?: (child: any) => void }} */ ({})) {
  const mine = generation;
  const run = () => {
    if (mine !== generation) return;
    const child = spawnAs(BROWSER, command, args, { stdio, env: ENV });
    children.add(child);
    child.on("error", () => log(`${name} cannot start`));
    child.on("exit", (code) => {
      children.delete(child);
      if (mine !== generation) return;
      log(`${name} exited (${code}); starting again in ${SCREEN_RESTART_MS / 1000}s`);
      setTimeout(run, SCREEN_RESTART_MS).unref();
    });
    started?.(child);
  };
  setTimeout(run, delay).unref();
}

export const isAwake = () => starting !== null;

// Stops Chromium, the window manager and the display. Sign-ins stay in the profile; the next
// browser step or take over starts them again.
export function sleepScreen() {
  if (!starting) return;
  generation++;
  starting = null;
  chromium = null;
  client?.destroy();
  for (const child of children) child.kill();
  log("asleep: nothing used it for a while");
}

export const hasScreen = () => existsSync(BIN.Xvnc) && existsSync(BIN.chromium);

function xauthority(cookie) {
  const field = (data) => Buffer.concat([Buffer.from([data.length >> 8, data.length & 255]), data]);
  return Buffer.concat([Buffer.from([0xff, 0xff]), field(Buffer.alloc(0)), field(Buffer.from("1")), field(Buffer.from("MIT-MAGIC-COOKIE-1")), field(cookie)]);
}

let starting = null;
export async function wakeScreen() {
  starting ??= startScreen().catch((err) => ((starting = null), Promise.reject(err)));
  await starting;
  for (const end = Date.now() + SCREEN_WAKE_MS; !(chromium && existsSync(SOCKET)); ) {
    if (Date.now() > end) throw new Error("The browser did not start in time");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function startScreen() {
  if (!hasScreen()) return log("not in this image; the browser is off");
  generation++;
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
      "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
      "--test-type", "--disable-background-networking", "--disable-sync", "--disable-component-update", "--no-pings", "--disable-domain-reliability",
      "--disable-features=CalculateNativeWinOcclusion,OptimizationHints,MediaRouter,Translate,PushMessaging",
      "--host-resolver-rules=MAP android.clients.google.com ~NOTFOUND, MAP mtalk.google.com ~NOTFOUND",
      `--user-data-dir=${PROFILE}`, "--remote-debugging-pipe",
      "--start-maximized", "about:blank",
    ],
    { delay: 2000, stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], started: attachPipe },
  );
}

let viewers = 0;
export const viewing = () => viewers > 0;

export function viewUpgrade(req, socket, head) {
  if (!hasScreen() || !chromium || !accept(req, socket, "binary")) return false;
  const screen = connect(SOCKET);
  viewers++;
  let ended = false;
  const end = () => {
    if (!ended) (ended = true), viewers--;
    screen.destroy();
    socket.destroy();
  };
  screen.on("error", end);
  socket.on("error", end);
  socket.on("close", end);
  screen.on("close", end);
  screen.on("data", (data) => {
    if (!socket.write(frame(data))) {
      screen.pause();
      socket.once("drain", () => screen.resume());
    }
  });
  readMessages(socket, head, MAX_VIEW_MESSAGE, (data) => screen.write(data), end);
  return true;
}

const SECRET = randomBytes(24).toString("hex");
let chromium = null;
let client = null;

export const cdpAddress = (port) => `ws://127.0.0.1:${port}/api/browser-cdp/${SECRET}`;
export const isCdpPath = (path) => path === `/api/browser-cdp/${SECRET}`;

function attachPipe(child) {
  const [, , , input, output] = child.stdio;
  input.on("error", () => {});
  const mine = { write: (text) => input.write(`${text}\0`) };
  chromium = mine;
  output.setEncoding("utf8").on("data", splitOn("\0", (message) => client?.write(frame(Buffer.from(message), 0x1))));
  child.on("exit", () => {
    if (chromium !== mine) return;
    chromium = null;
    client?.destroy();
  });
}

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
