// What an agent may ask manage_settings to change (settings/manage.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { planSettings } from "../daemon/settings/manage.mjs";

const models = [
  { provider: "anthropic", id: "big", contextWindow: 1_000_000 },
  { provider: "anthropic", id: "small", contextWindow: 200_000 },
  { provider: "openai", id: "gpt", contextWindow: 400_000 },
  { provider: "openai", id: "nowindow" },
];
const now = { enabled: ["anthropic/big", "openai/gpt"], models, users: { "anthropic/big": ["Coder", "the memory curator"] }, overrides: {} };
const refused = (request, pattern, state = now) => assert.throws(() => planSettings(request, state), pattern);

test("only models, and when they are summarized", () => {
  refused({ packages: ["x"] }, /not packages/);
  refused({ enabledModels: [] }, /not enabledModels/);
  refused({}, /Nothing would change/);
  refused({ enable: "anthropic/small" }, /not valid/);
  refused({ compaction: [] }, /not valid/);
});

test("turns on only models a key or sign-in can use", () => {
  refused({ enable: ["mistral/large"] }, /mistral\/large: not a model/);
  const plan = planSettings({ enable: ["anthropic/small"] }, now);
  assert.deepEqual(plan.enabledModels, ["anthropic/big", "openai/gpt", "anthropic/small"]);
  assert.match(plan.lines[0], /Turn on the models anthropic\/small/);
});

test("turns off no model in use, and never the last", () => {
  refused({ disable: ["anthropic/big"] }, /anthropic\/big \(used by Coder, the memory curator\)/);
  assert.deepEqual(planSettings({ disable: ["openai/gpt"] }, now).enabledModels, ["anthropic/big"]);
  refused({ disable: ["anthropic/big"] }, /At least one model/, { ...now, enabled: ["anthropic/big"], users: {} });
});

test("with none chosen (all on), turning one off keeps the others on", () => {
  const all = { ...now, enabled: [] };
  assert.deepEqual(planSettings({ disable: ["openai/gpt"] }, all).enabledModels, ["anthropic/big", "anthropic/small", "openai/nowindow"]);
  refused({ enable: ["openai/gpt"] }, /Nothing would change/, all);
});

test("compaction stays within the bounds compaction.mjs keeps", () => {
  refused({ compaction: { "anthropic/small": 1000 } }, /between 16384 and 199999/);
  refused({ compaction: { "anthropic/small": 200_000 } }, /between/);
  refused({ compaction: { "anthropic/small": 20_000.5 } }, /between/);
  refused({ compaction: { "anthropic/small": "20000" } }, /between/);
  refused({ compaction: { "openai/nowindow": 20_000 } }, /window is not known/);
  const plan = planSettings({ compaction: { "anthropic/small": 40_000, "openai/gpt": null } }, now);
  assert.deepEqual(plan.compaction, { "anthropic/small": 40_000, "openai/gpt": null });
  assert.equal(plan.enabledModels, undefined);
  assert.match(plan.lines[0], /40000 of its 200000 tokens are left free, at 80% \(now 20000 free\)/);
});
