// What agents may ask of manage_agents, and what applies without asking the user (agents/manage.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedAlways, extensionsIn, more, refusal } from "../daemon/agents/manage.mjs";
import { askUser } from "../daemon/agents/runner.mjs";
import { MAX_APPROVAL } from "../daemon/config.mjs";

const agent = (fields) => ({ model: "anthropic/claude", plugins: [], skills: [], extensions: [], disabled: [], isolated: false, trusted: false, ...fields });
const coder = agent({ id: "coder", name: "Coder" });
const writer = agent({ id: "writer", name: "Writer" });
const diary = agent({ id: "diary", name: "Diary", isolated: true, disabled: ["browser"] });
const other = agent({ id: "other", name: "Other", isolated: true });

test("no request sets isolated or trusted", () => {
  for (const asker of [coder, diary]) {
    assert.ok(refusal(asker, "update", asker, { isolated: false }));
    assert.ok(refusal(asker, "update", asker, { trusted: true }));
  }
  assert.ok(refusal(coder, "create", null, { name: "x", isolated: true }));
});

test("a regular agent may make agents and change regular ones, not isolated ones", () => {
  assert.equal(refusal(coder, "create", null, { name: "x" }), null);
  assert.equal(refusal(coder, "update", writer, { instructions: "x", model: "openai/gpt" }), null);
  assert.equal(refusal(coder, "update", coder, { plugins: ["mail"] }), null);
  assert.match(refusal(coder, "update", diary, { skills: [] }), /isolated/);
});

test("an isolated agent may only ask for skills, plugins and extensions, for itself", () => {
  assert.ok(refusal(diary, "create", null, { name: "x" }));
  assert.ok(refusal(diary, "update", other, { skills: [] }));
  assert.ok(refusal(diary, "update", coder, { skills: [] }));
  for (const field of ["name", "instructions", "model", "thinking"]) assert.ok(refusal(diary, "update", diary, { [field]: "x" }), field);
  assert.equal(refusal(diary, "update", diary, { skills: ["a"], plugins: ["b"], extensions: ["routines", "browser"] }), null);
});

test("a change is allowed always only when trusted, to itself, and only instructions, thinking or skills", () => {
  const trusted = { ...coder, trusted: true };
  assert.equal(allowedAlways(trusted, trusted, { instructions: "x" }), true);
  assert.equal(allowedAlways(trusted, trusted, { thinking: "high", skills: ["a"] }), true);
  assert.equal(allowedAlways(coder, coder, { instructions: "x" }), false, "not trusted");
  assert.equal(allowedAlways(trusted, writer, { instructions: "x" }), false, "another agent");
  for (const field of ["plugins", "extensions", "model", "name"]) assert.equal(allowedAlways(trusted, trusted, { [field]: [] }), false, field);
  assert.equal(allowedAlways(trusted, trusted, { instructions: "x", plugins: [] }), false, "mixed");
  assert.equal(allowedAlways(trusted, trusted, {}), false, "nothing");
  const trustedDiary = { ...diary, trusted: true };
  assert.equal(allowedAlways(trustedDiary, trustedDiary, { skills: ["a"] }), true);
  assert.equal(allowedAlways(trustedDiary, trustedDiary, { plugins: ["a"] }), false);
  assert.equal(allowedAlways(trustedDiary, trustedDiary, { extensions: ["routines"] }), false);
});

test("an agent's extensions name the bundled ones it has on and the added ones", () => {
  assert.deepEqual(extensionsIn(diary), ["routines"]);
  assert.deepEqual(extensionsIn(agent({ extensions: ["pdf"] })), ["browser", "routines", "pdf"]);
});

test("the question warns of a provider, plugins, extensions the asker lacks, and of the browser", () => {
  assert.equal(more(coder, coder, coder), "");
  assert.match(more(coder, { ...coder, model: "openai/gpt" }), /provider openai/);
  assert.match(more(coder, { ...coder, plugins: ["mail"] }), /plugin mail, which Coder/);
  assert.match(more(coder, { ...coder, extensions: ["pdf"] }), /extension pdf, which Coder/);
  assert.match(more(diary, { ...diary, disabled: [] }, diary), /the browser/);
  assert.doesNotMatch(more(coder, coder, coder), /browser/);
  assert.doesNotMatch(more(coder, writer), /browser/, "a new agent with the browser the asker has");
  assert.match(more({ ...coder, disabled: ["browser"] }, writer), /browser/, "a new agent with the browser the asker lacks");
  assert.match(more(coder, writer, { ...writer, disabled: ["browser"] }), /browser/, "an agent that gets the browser");
});

test("a question too long to read in full is refused before it is asked, never cut", async () => {
  // Checked first: no agent or run is needed to refuse it.
  await assert.rejects(askUser("nobody", "x".repeat(MAX_APPROVAL + 1), ["Yes", "No"]), (err) => err.status === 400 && /too long/.test(err.message));
  await assert.rejects(askUser("nobody", "x".repeat(MAX_APPROVAL), ["Yes", "No"]), (err) => err.status === 409);
});
