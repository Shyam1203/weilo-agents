// Isolated agents: where their files are, and which of the agents' routes they may call (agents/agents.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { chatDirOf, filesOf, homeGroupOf, homeOf, isIsolated, isolatedGroups, mayCall, userHomeOf, userOf } from "../daemon/agents/agents.mjs";
import { ISOLATED, ISOLATED_SESSIONS, SESSIONS, WORKSPACE, HOMES } from "../daemon/common.mjs";
import { AGENTS_GID, CORE_TOOLS } from "../daemon/config.mjs";

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

test("a regular agent is in every isolated agent's group; an isolated one only in its own", () => {
  const other = { ...isolated, id: "other-a0a0a0", folder: "other", uid: 2005 };
  const all = [regular, isolated, other, { ...regular, id: "two-b1b1b1", uid: 2003 }];
  assert.deepEqual(isolatedGroups(all), [2002, 2005]);
  assert.deepEqual(userOf(regular, all), { uid: 2001, gid: 2001, groups: [AGENTS_GID, 2002, 2005] });
  assert.deepEqual(userOf(isolated, all), { uid: 2002, gid: 2002, groups: [] });
  assert.deepEqual(userOf(regular, [regular]).groups, [AGENTS_GID]);
});

test("an isolated agent's home is in its own group; a regular agent's in the agents group", () => {
  assert.equal(homeGroupOf(isolated), 2002);
  assert.equal(homeGroupOf(regular), AGENTS_GID);
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

test("pi offers an agent exactly our tools it may call", () => {
  // runner.mjs builds the --tools list from `mayCall`: none of our tools is a bundled extension's, so only the shared ones go.
  assert.deepEqual(CORE_TOOLS.filter((t) => mayCall(regular, t)), ["show", "ask", "manage_agents", "skill", "memory", "fetch_knowledge", "manage_settings"]);
  assert.deepEqual(CORE_TOOLS.filter((t) => mayCall(isolated, t)), ["show", "ask", "manage_agents"]);
  assert.deepEqual(CORE_TOOLS.filter((t) => mayCall({ ...isolated, disabled: [] }, t)), ["show", "ask", "manage_agents"]);
});

test("an isolated agent reaches a bundled extension's routes only while it has it on", () => {
  assert.equal(mayCall(isolated, "browser"), false);
  assert.equal(mayCall(isolated, "routines"), true);
  assert.equal(mayCall({ ...isolated, disabled: [] }, "browser"), true);
  // A regular agent may replace a bundled extension with its own, which calls the same route.
  assert.equal(mayCall({ ...regular, disabled: ["browser"] }, "browser"), true);
});
