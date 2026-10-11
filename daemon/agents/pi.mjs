import { spawn } from "node:child_process";
import { PI_KILL_MS } from "../config.mjs";

// Runs a child that speaks pi's RPC protocol (`pi --mode rpc …`): one JSON record per line.
//   onEvent(record)                every record that is not a command response
//   onExit({ code, signal, message })  once, when the child ends; message is the last line pi wrote to stderr
// Returns { send(type, fields, onReply), reply(record), close() }; send resolves with the response data, or rejects
// with pi's error (or that message, if pi exited first). onReply(data) runs before any later
// record is handled, so a caller can act on a reply without missing the events after it.
export function spawnPi(argv, { cwd, env, onEvent, onExit } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env } });
  const pending = new Map();
  let nextId = 0;
  let buffer = "";
  let stderr = "";
  let done = false;
  let killer;

  const finish = (code, signal) => {
    if (done) return;
    done = true;
    clearTimeout(killer);
    const message = stderr.trim().split("\n").at(-1) || `pi exited (${code ?? signal})`;
    pending.forEach((p) => p.reject(new Error(message)));
    onExit?.({ code, signal, message });
  };

  const record = (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // stdout carries protocol records only
    }
    if (msg.type !== "response") return onEvent?.(msg);
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (!msg.success) return p?.reject(new Error(msg.error));
    p?.onReply?.(msg.data);
    p?.resolve(msg.data);
  };

  // Split on LF only: readline would also split on U+2028/2029, which JSON strings may contain.
  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    const lines = (buffer + chunk).split("\n");
    buffer = lines.pop();
    for (const line of lines) if (line.trim()) record(line);
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr = (stderr + chunk).slice(-4000)));
  child.stdin.on("error", () => {}); // writing after the child exited
  child.on("error", (err) => {
    stderr += err.message;
    finish(null, null);
  });
  child.on("close", finish);

  const send = (type, fields, onReply) =>
    new Promise((resolve, reject) => {
      if (done) return reject(new Error("pi is not running"));
      const id = String(++nextId);
      pending.set(id, { resolve, reject, onReply });
      child.stdin.write(JSON.stringify({ id, type, ...fields }) + "\n");
    });

  // A record that answers pi (it asked something and waits): no response comes back.
  const reply = (record) => child.stdin.write(JSON.stringify(record) + "\n");

  // Closing stdin asks pi to shut down in order; kill it if it does not.
  const close = () => {
    if (done) return;
    child.stdin.end();
    killer ??= setTimeout(() => child.kill(), PI_KILL_MS).unref();
  };

  return { send, reply, close };
}
