import "./root.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { addUsage, tokensOf, usageHistory, usageToday } from "../agents/usage.mjs";
import { audit, recentAudit } from "../audit.mjs";

test("the audit log keeps changes, newest first", async () => {
  audit("PUT /api/agents/:id", { by: "device d1", id: "a1" });
  audit("approval", { agent: "a1", question: "Change it?", answer: "Don't" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const [last, first] = await recentAudit(10);
  assert.equal(last.event, "approval");
  assert.deepEqual({ ...first, at: undefined }, { at: undefined, event: "PUT /api/agents/:id", by: "device d1", id: "a1" });
});

test("tokens count what was read and written, not what came from the cache", async () => {
  assert.equal(tokensOf({ input: 100, output: 50, cacheRead: 100000, cacheWrite: 10 }), 160);
  assert.equal(tokensOf(undefined), 0);
  assert.equal(await addUsage("a1", { input: 100, output: 60, cost: { total: 0.25 } }), 160);
  assert.equal(await addUsage("a1", { output: 40, cost: { total: 0.05 } }), 200);
  assert.deepEqual(await usageToday(), { a1: 200 });
  const days = await usageHistory(3);
  assert.equal(days.length, 3);
  assert.deepEqual(days.at(-1).agents.a1, { tokens: 200, cost: 0.3 });
  assert.deepEqual(days[0].agents, {});
});
