import assert from "node:assert/strict";
import { test } from "node:test";
import { planSettings } from "../settings/manage.mjs";
import { planSkill } from "../settings/skills.mjs";

const now = {
  enabled: ["a/one", "a/two"],
  models: [{ provider: "a", id: "one", contextWindow: 200000 }, { provider: "a", id: "two", contextWindow: 1000000 }, { provider: "b", id: "three" }],
  users: { "a/one": ["Researcher"] },
  overrides: {},
};

test("a settings request becomes a plan the user can read", () => {
  const plan = planSettings({ enable: ["b/three"], disable: ["a/two"], compaction: { "a/one": 50000 } }, now);
  assert.deepEqual(plan.enabledModels, ["a/one", "b/three"]);
  assert.deepEqual(plan.compaction, { "a/one": 50000 });
  assert.equal(plan.lines.length, 3);
});

test("a request that would break an agent, or names what is not there, is refused", () => {
  assert.throws(() => planSettings({ disable: ["a/one"] }, now), /used by Researcher/);
  assert.throws(() => planSettings({ enable: ["z/none"] }, now), /not a model/);
  assert.throws(() => planSettings({ compaction: { "a/one": 10 } }, now), /keep between/);
  assert.throws(() => planSettings({ compaction: { "b/three": 20000 } }, now), /not known/);
  assert.throws(() => planSettings({ keys: [] }, now), /not keys/);
  assert.throws(() => planSettings({}, now), /Nothing would change/);
});

test("a skill is checked and written out before the user is asked", async () => {
  const skill = planSkill({ name: "Book a Table", description: "When booking:  a restaurant.", instructions: "  1. Open the site.\n" });
  assert.equal(skill.id, "book-a-table");
  assert.equal(skill.about, "When booking: a restaurant.");
  assert.equal(skill.text, '---\nname: book-a-table\ndescription: "When booking: a restaurant."\n---\n\n1. Open the site.\n');
  assert.throws(() => planSkill({ name: "x", description: "", instructions: "y" }), /description/);
  assert.throws(() => planSkill({ name: "x", description: "y", instructions: " " }), /instructions/);
});
