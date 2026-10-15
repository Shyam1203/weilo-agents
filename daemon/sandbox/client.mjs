import { EventEmitter } from "node:events";
import { connect } from "node:net";
import { PassThrough } from "node:stream";
import { SANDBOX_CTL } from "../config.mjs";
import { decoder } from "./frames.mjs";

const DOWN = "The sandbox for isolated agents is not running. Start the app again with its start script, or run: docker compose up -d";

export function spawnSandboxed(spec) {
  const socket = connect({ path: SANDBOX_CTL, allowHalfOpen: true });
  const child = Object.assign(new EventEmitter(), { stdin: socket, stdout: new PassThrough(), stderr: new PassThrough(), kill: () => socket.destroy() });
  let exit = { code: null, signal: null };
  socket.write(`${JSON.stringify(spec)}\n`);
  socket.on(
    "data",
    decoder((type, data) => {
      if (type === "o") child.stdout.write(data);
      else if (type === "e") child.stderr.write(data);
      else if (type === "x") exit = JSON.parse(data);
    }),
  );
  socket.on("end", () => socket.end());
  socket.on("error", (/** @type {NodeJS.ErrnoException} */ err) => child.emit("error", ["ENOENT", "ECONNREFUSED"].includes(err.code) ? new Error(DOWN) : err));
  socket.on("close", () => {
    child.stdout.end();
    child.stderr.end();
    child.emit("exit", exit.code, exit.signal);
    child.emit("close", exit.code, exit.signal);
  });
  return child;
}

export const sandboxStatus = () =>
  new Promise((resolve) => {
    const socket = connect(SANDBOX_CTL);
    let text = "";
    socket.setTimeout(3000, () => socket.destroy());
    socket.on("data", (d) => (text += d));
    socket.on("error", () => {});
    socket.on("close", () => {
      try {
        resolve({ running: true, ...JSON.parse(text) });
      } catch {
        resolve({ running: false, namespaces: false });
      }
    });
    socket.end('{"ping":true}\n');
  });
