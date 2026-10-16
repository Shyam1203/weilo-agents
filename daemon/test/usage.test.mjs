import { root } from "./root.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { addUsage, backfillUsage, usageHistory } from "../agents/usage.mjs";

const reply = (ms, input, output) => `${JSON.stringify({ type: "message", message: { role: "assistant", timestamp: ms, usage: { input, output, cacheWrite: 0, cost: { total: 0.01 } } } })}\n`;

test("usage from before the Usage page is counted once from the chats", async () => {
  const now = Date.now();
  const dir = join(root, "agent/sessions/u1");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "1.jsonl"), reply(now - 2 * 864e5, 100, 50) + reply(now - 2 * 864e5, 10, 5) + reply(now, 7, 3));
  await addUsage("u1", { input: 20, output: 0 });
  await backfillUsage();
  await backfillUsage();
  const days = await usageHistory(3);
  assert.equal(days[0].agents.u1.tokens, 165);
  assert.equal(days[2].agents.u1.tokens, 20);
  await addUsage("u1", { input: 5, output: 0 });
  assert.equal((await usageHistory(1))[0].agents.u1.tokens, 25);
});
