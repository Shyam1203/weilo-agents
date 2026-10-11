import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { CDP_PORT, MAX_VIEW_MESSAGE, SCREEN, SCREEN_RESTART_MS } from "../config.mjs";

// The browser's screen: a virtual display (Xvnc) with a window manager and one Chromium. The daemon
// starts them and starts them again if they stop. The display listens on a unix socket only, so
// nothing else in the container, a web page in Chromium included, can reach it; the user's
// browser sees it through the daemon's own port, with the same checks as the API (`viewUpgrade`).

const DISPLAY = ":1";
const SOCKET = "/tmp/weilo-screen.sock";
// Chromium's profile (logins, cookies) lives in a volume: a profile on a Windows bind mount can't lock its files.
const PROFILE = "/home/node/.browser";

const log = (...args) => console.log("[screen]", ...args);

// Keeps a program running. A program that is missing means the image has no screen (a dev run): skip it.
function keep(name, command, args, { delay = 0 } = {}) {
  const run = () => {
    const child = spawn(command, args, { stdio: "ignore", env: { ...process.env, DISPLAY } });
    child.on("error", () => log(`${name} cannot start`));
    child.on("exit", (code) => {
      log(`${name} exited (${code}); starting again in ${SCREEN_RESTART_MS / 1000}s`);
      setTimeout(run, SCREEN_RESTART_MS).unref();
    });
  };
  setTimeout(run, delay).unref();
}

export const hasScreen = () => existsSync("/usr/bin/Xvnc") && existsSync("/usr/bin/chromium");

export function startScreen() {
  if (!hasScreen()) return log("not in this image; the browser is off");
  // After a restart the old display and browser leave their lock files behind.
  rmSync("/tmp/.X1-lock", { force: true });
  rmSync("/tmp/.X11-unix/X1", { force: true });
  rmSync(SOCKET, { force: true });
  for (const file of existsSync(PROFILE) ? readdirSync(PROFILE).filter((f) => f.startsWith("Singleton")) : []) rmSync(join(PROFILE, file), { force: true });

  keep("display", "Xvnc", [DISPLAY, "-geometry", `${SCREEN.width}x${SCREEN.height}`, "-depth", "24", "-SecurityTypes", "None", "-rfbunixpath", SOCKET, "-rfbport", "-1", "-nolisten", "tcp"]);
  keep("windows", "openbox", [], { delay: 1000 });
  keep(
    "browser",
    "chromium",
    [
      "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-crash-restore-bubble",
      // A window behind another keeps working: agents use their own windows at the same time.
      "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
      // Private by default: no sync, component updates or other background calls to Google.
      "--test-type", "--disable-background-networking", "--disable-sync", "--disable-component-update", "--no-pings", "--disable-domain-reliability",
      "--disable-features=CalculateNativeWinOcclusion,OptimizationHints,MediaRouter,Translate,PushMessaging",
      "--host-resolver-rules=MAP android.clients.google.com ~NOTFOUND, MAP mtalk.google.com ~NOTFOUND",
      `--user-data-dir=${PROFILE}`, "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${CDP_PORT}`,
      "--start-maximized", "about:blank",
    ],
    { delay: 2000 },
  );
}

// --- The live view: a WebSocket to the screen ---
// noVNC in the user's browser speaks VNC in binary WebSocket messages. The display speaks plain
// VNC on its unix socket. This turns one into the other.

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// A server-to-client message: one unmasked binary frame.
function frame(payload, opcode = 0x2) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n]) : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | opcode, 127]), Buffer.alloc(8)]);
  if (n >= 65536) head.writeBigUInt64BE(BigInt(n), 2);
  return Buffer.concat([head, payload]);
}

/**
 * Passes a WebSocket upgrade from the user's browser to the screen. The caller has already checked
 * who is asking. Returns false when this is not a WebSocket request or the screen is off.
 */
export function viewUpgrade(req, socket, head) {
  const key = req.headers["sec-websocket-key"];
  if (!hasScreen() || req.headers.upgrade?.toLowerCase() !== "websocket" || !key) return false;
  const binary = String(req.headers["sec-websocket-protocol"] ?? "").split(",").some((p) => p.trim() === "binary");
  socket.write(
    ["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${createHash("sha1").update(key + GUID).digest("base64")}`, ...(binary ? ["Sec-WebSocket-Protocol: binary"] : []), "", ""].join("\r\n"),
  );

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

  // Client messages are masked frames; the data of each goes to the screen.
  let buffer = head?.length ? Buffer.from(head) : Buffer.alloc(0);
  const read = () => {
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      let length = buffer[1] & 0x7f;
      let at = 2;
      if (length === 126) (length = buffer.length >= 4 ? buffer.readUInt16BE(2) : -1), (at = 4);
      else if (length === 127) (length = buffer.length >= 10 ? Number(buffer.readBigUInt64BE(2)) : -1), (at = 10);
      if (length < 0) return; // the length has not all arrived
      if (length > MAX_VIEW_MESSAGE) return end();
      const masked = (buffer[1] & 0x80) !== 0;
      const after = at + (masked ? 4 : 0) + length;
      if (buffer.length < after) return;
      const mask = masked ? buffer.subarray(at, at + 4) : null;
      const payload = Buffer.from(buffer.subarray(at + (masked ? 4 : 0), after));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buffer = buffer.subarray(after);
      if (opcode === 0x8) return end(); // close
      if (opcode === 0x9) socket.write(frame(payload, 0xa)); // ping
      else if (opcode <= 0x2) screen.write(payload); // data (noVNC sends binary)
    }
  };
  socket.on("data", (data) => {
    buffer = Buffer.concat([buffer, data]);
    read();
  });
  read();
  return true;
}
