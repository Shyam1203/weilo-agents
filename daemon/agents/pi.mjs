import { PI_KILL_MS } from "../config.mjs";

export function piRpc(child, { onEvent, onExit } = /** @type {{ onEvent?: (event: any) => void, onExit?: (exit: { code: number | null, signal: string | null, message: string }) => void }} */ ({})) {
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
      return;
    }
    if (msg.type !== "response") return onEvent?.(msg);
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (!msg.success) return p?.reject(new Error(msg.error));
    p?.onReply?.(msg.data);
    p?.resolve(msg.data);
  };

  child.stdout.setEncoding("utf8").on("data", (chunk) => {
    const lines = (buffer + chunk).split("\n");
    buffer = lines.pop();
    for (const line of lines) if (line.trim()) record(line);
  });
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr = (stderr + chunk).slice(-4000)));
  child.stdin.on("error", () => {});
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

  const reply = (record) => child.stdin.write(JSON.stringify(record) + "\n");

  const close = () => {
    if (done) return;
    child.stdin.end();
    killer ??= setTimeout(() => child.kill(), PI_KILL_MS).unref();
  };

  return { send, reply, close };
}
