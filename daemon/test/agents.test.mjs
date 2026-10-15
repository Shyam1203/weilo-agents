import "./root.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { homeModeOf, isIsolated, mayCall, userHomeOf, userOf } from "../agents/agents.mjs";
import { allowedAlways, refusal } from "../agents/manage.mjs";

const regular = { id: "r", name: "R", uid: 2001, folder: "r", isolated: false, trusted: false, disabled: [] };
const isolated = { id: "i", name: "I", uid: 2002, folder: "i", isolated: true, trusted: false, disabled: ["browser"] };

test("an isolated agent may not use what is shared", () => {
  for (const tool of ["memory", "fetch_knowledge", "skill", "manage_settings", "ask_agent"]) {
    assert.equal(mayCall(isolated, tool), false, tool);
    assert.equal(mayCall(regular, tool), true, tool);
  }
  assert.equal(mayCall(isolated, "browser"), false);
  assert.equal(mayCall({ ...isolated, disabled: [] }, "browser"), true);
  assert.equal(mayCall(isolated, "routines"), true);
});

test("each kind of agent is its own user, and others only read an isolated folder", () => {
  assert.deepEqual(userOf(regular), { uid: 2001, gid: 2001, groups: [2000] });
  assert.deepEqual(userOf(isolated), { uid: 2002, gid: 2002, groups: [] });
  assert.equal(homeModeOf(regular), 0o2770);
  assert.equal(homeModeOf(isolated), 0o2775);
  assert.match(userHomeOf(isolated), /isolated-homes\/i$/);
  assert.ok(isIsolated(isolated) && !isIsolated(regular));
});

test("agents' requests are refused where only the user decides", () => {
  assert.match(refusal(regular, "update", regular, { isolated: true }), /Only the user/);
  assert.match(refusal(isolated, "create", null, {}), /cannot make agents/);
  assert.match(refusal(isolated, "update", regular, {}), /only itself/);
  assert.match(refusal(isolated, "update", isolated, { instructions: "x" }), /only for skills/);
  assert.match(refusal(regular, "update", isolated, { skills: [] }), /only the user changes/);
  assert.equal(refusal(regular, "update", regular, { instructions: "x" }), null);
  assert.equal(refusal(isolated, "update", isolated, { skills: ["a"] }), null);
});

test("a trusted agent changes only its own instructions, thinking or skills without asking", () => {
  const trusted = { ...regular, trusted: true };
  assert.equal(allowedAlways(trusted, trusted, { instructions: "x", skills: [] }), true);
  assert.equal(allowedAlways(trusted, trusted, { model: "a/b" }), false);
  assert.equal(allowedAlways(trusted, isolated, { instructions: "x" }), false);
  assert.equal(allowedAlways(regular, regular, { instructions: "x" }), false);
});
