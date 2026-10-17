import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { connect, createServer } from "node:net";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { BIN, MAX_SPEC, PI_KILL_MS, PORT, SANDBOX_API, SANDBOX_CTL, SANDBOX_DIR } from "../config.mjs";
import { encode } from "./frames.mjs";
import { checkSpec } from "./spec.mjs";

const ENTER = fileURLToPath(new URL("./enter.mjs", import.meta.url));
const NAMESPACES = ["--pid", "--fork", "--kill-child", "--mount", "--mount-proc", "--ipc", "--uts"];
const ready = spawnSync(BIN.unshare, [...NAMESPACES, "/bin/true"]).status === 0;
if (!ready) console.error("The sandbox cannot make namespaces, so it starts nothing. Give it SYS_ADMIN (and, where AppArmor is on, apparmor:unconfined), as compose.yaml does.");

function start(socket, spec, rest) {
  const child = spawn(BIN.unshare, [...NAMESPACES, "--", BIN.tini, "--", process.execPath, ENTER], { env: {}, stdio: ["pipe", "pipe", "pipe", "pipe"] });
  const specPipe = child.stdio[3];
  if (specPipe instanceof Writable) specPipe.end(JSON.stringify(spec));
  const send = (type, data) => !socket.destroyed && socket.write(encode(type, data));
  child.stdout.on("data", (data) => send("o", data));
  child.stderr.on("data", (data) => send("e", data));
  child.on("error", (err) => send("e", err.message));
  child.on("close", (code, signal) => (send("x", { code, signal }), socket.end()));
  child.stdin.on("error", () => {});
  if (rest.length) child.stdin.write(rest);
  socket.pipe(child.stdin);
  const kill = () => child.exitCode === null && child.signalCode === null && child.kill("SIGKILL");
  socket.on("end", () => setTimeout(kill, PI_KILL_MS).unref());
  socket.on("close", kill);
}

function serve(socket) {
  let head = Buffer.alloc(0);
  socket.on("error", () => socket.destroy());
  const onData = (chunk) => {
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf(10);
    if (end < 0) return head.length > MAX_SPEC && socket.destroy();
    socket.off("data", onData);
    try {
      const request = JSON.parse(head.subarray(0, end).toString("utf8"));
      if (request.ping) return socket.end(`${JSON.stringify({ namespaces: ready })}\n`);
      if (!ready) throw new Error("The sandbox cannot make namespaces. See its log: docker compose logs sandbox");
      start(socket, checkSpec(request), head.subarray(end + 1));
    } catch (err) {
      socket.end(Buffer.concat([encode("e", err.message), encode("x", { code: 1, signal: null })]));
    }
  };
  socket.on("data", onData);
}

rmSync(SANDBOX_CTL, { force: true });
mkdirSync(SANDBOX_DIR, { recursive: true, mode: 0o700 });
createServer({ allowHalfOpen: true }, serve).listen(SANDBOX_CTL, () => console.log("weilo-sandbox ready"));

createServer((agent) => {
  const app = connect(SANDBOX_API);
  const end = () => (agent.destroy(), app.destroy());
  agent.on("error", end).pipe(app).on("error", end).pipe(agent);
}).listen(PORT, "127.0.0.1");

for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => process.exit(0));
