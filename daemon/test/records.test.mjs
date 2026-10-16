import "./root.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import { addUsage, tokensOf, usageHistory, usageToday } from "../agents/usage.mjs";
import { audit, recentAudit } from "../audit.mjs";
import { USAGE } from "../common.mjs";

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

test("today's count from the older usage file carries over", async () => {
  const [{ day }] = await usageHistory(1);
  await writeFile(USAGE, JSON.stringify({ day, agents: { a9: 50 } }));
  assert.deepEqual(await usageToday(), { a9: 50 });
  assert.equal(await addUsage("a9", { output: 5 }), 55);
});

test("a state file that is not valid JSON is read from its last good copy", async () => {
  const { join } = await import("node:path");
  const { root } = await import("./root.mjs");
  const { readJson, updateJson } = await import("../common.mjs");
  const file = join(root, "agent", "state.json");
  await updateJson(file, () => ({ n: 1 }));
  await updateJson(file, () => ({ n: 2 }));
  await writeFile(file, "{ broken");
  assert.deepEqual(await readJson(file), { n: 1 });
});
