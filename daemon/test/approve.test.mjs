import "./root.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test } from "node:test";
import { checkAgent, profilePath } from "../agents/agents.mjs";
import { approve } from "../agents/approve.mjs";
import { isNothingNew } from "../agents/runner.mjs";

const profile = (id, fields) => (mkdirSync(dirname(profilePath(id)), { recursive: true }), writeFileSync(profilePath(id), JSON.stringify({ name: id, model: "anthropic/x", folder: id, uid: 3000, ...fields })));

test("what an agent may do without asking is a short list of known kinds", async () => {
  const agent = await checkAgent({ name: "A", model: "anthropic/x", allow: ["skill", "ask:coder-1a2b3c", "skill"] });
  assert.deepEqual(agent.allow, ["skill", "ask:coder-1a2b3c"]);
  await assert.rejects(checkAgent({ name: "A", model: "anthropic/x", allow: ["everything"] }), /not valid/);
  await assert.rejects(checkAgent({ name: "A", model: "anthropic/x", allow: "skill" }), /not valid/);
});

test("an always-allowed request goes ahead without asking; any other asks the user", async () => {
  profile("allowed-1", { allow: ["skill"] });
  assert.deepEqual(await approve("allowed-1", "skill", "Save it?", ["Save it", "Don't"]), { answer: "Save it", always: true });
  // Not allowed always: it asks, and here there is no run to ask in.
  await assert.rejects(approve("allowed-1", "settings", "Change it?", ["Change it", "Don't"]), /not in a run/);
});

test("a reply of only NOTHING_NEW is a quiet one", () => {
  assert.ok(isNothingNew("NOTHING_NEW"));
  assert.ok(isNothingNew(" NOTHING_NEW. NOTHING_NEW\n"));
  assert.ok(!isNothingNew(""));
  assert.ok(!isNothingNew("NOTHING_NEW, but the price fell"));
  assert.ok(!isNothingNew("NOTHING_NEW_POLICY"));
});
