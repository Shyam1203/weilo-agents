import { appendFile, open, rename, stat } from "node:fs/promises";
import { AUDIT } from "./common.mjs";

const MAX = 5e6;
const TAIL = 256 * 1024;

let queue = Promise.resolve();
export function audit(event, fields = {}) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`;
  queue = queue
    .then(async () => {
      if (((await stat(AUDIT).catch(() => null))?.size ?? 0) > MAX) await rename(AUDIT, `${AUDIT}.1`);
      await appendFile(AUDIT, line, { mode: 0o600 });
    })
    .catch((err) => console.error("Audit log:", err.message));
}

export async function recentAudit(count) {
  const file = await open(AUDIT).catch(() => null);
  if (!file) return [];
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - TAIL);
    const { buffer } = await file.read(Buffer.alloc(size - start), 0, size - start, start);
    const lines = buffer.toString("utf8").split("\n").slice(start ? 1 : 0);
    return lines.flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    }).slice(-count).reverse();
  } finally {
    await file.close();
  }
}
