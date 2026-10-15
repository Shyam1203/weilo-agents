// Isolated agents: where their files are, and which of the agents' routes they may call (agents/agents.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { chatDirOf, filesOf, homeOf, isIsolated, mayCall, userHomeOf, userOf } from "../daemon/agents/agents.mjs";
import { ISOLATED, ISOLATED_SESSIONS, SESSIONS, WORKSPACE, HOMES } from "../daemon/common.mjs";
import { AGENTS_GID } from "../daemon/config.mjs";

const regular = { id: "coder-a1b2c3", folder: "coder", uid: 2001, disabled: [], isolated: false };
const isolated = { id: "diary-d4e5f6", folder: "diary", uid: 2002, disabled: ["browser"], isolated: true };

test("only isolated: true is isolated", () => {
  assert.equal(isIsolated(regular), false);
  assert.equal(isIsolated(isolated), true);
  assert.equal(isIsolated({ isolated: "yes" }), false);
});

test("an isolated agent's folders are outside the workspace and agent/", () => {
  assert.equal(homeOf(regular), `${WORKSPACE}/coder`);
  assert.equal(homeOf(isolated), `${ISOLATED}/diary`);
  assert.equal(chatDirOf(regular), `${SESSIONS}/coder-a1b2c3`);
  assert.equal(chatDirOf(isolated), `${ISOLATED_SESSIONS}/diary-d4e5f6`);
  assert.equal(userHomeOf(isolated), `${HOMES}/diary`);
  assert.throws(() => homeOf({ ...isolated, folder: "../agent" }));
});

test("an isolated agent's user is in no group", () => {
  assert.deepEqual(userOf(regular).groups, [AGENTS_GID]);
  assert.deepEqual(userOf(isolated), { uid: 2002, gid: 2002, groups: [] });
});

test("an isolated agent's chat shows only its own files; a regular agent's, the workspace's and isolated agents'", () => {
  assert.deepEqual(filesOf(isolated), { folders: [`${ISOLATED}/diary`], roots: [`${ISOLATED}/diary`] });
  assert.deepEqual(filesOf(regular).roots, [WORKSPACE, ISOLATED]);
});

test("an isolated agent may not call the tools of what all agents share", () => {
  for (const tool of ["memory", "fetch_knowledge", "skill", "manage_settings"]) {
    assert.equal(mayCall(regular, tool), true, tool);
    assert.equal(mayCall(isolated, tool), false, tool);
  }
  for (const tool of ["manage_agents", "model"]) assert.equal(mayCall(isolated, tool), true, tool);
});

test("an isolated agent reaches a bundled extension's routes only while it has it on", () => {
  assert.equal(mayCall(isolated, "browser"), false);
  assert.equal(mayCall(isolated, "routines"), true);
  assert.equal(mayCall({ ...isolated, disabled: [] }, "browser"), true);
  // A regular agent may replace a bundled extension with its own, which calls the same route.
  assert.equal(mayCall({ ...regular, disabled: ["browser"] }, "browser"), true);
});
