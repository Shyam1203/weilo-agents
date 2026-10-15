import { root } from "./root.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { openIndex } from "../agents/chats.mjs";
import { fetchKnowledge } from "../memory/fetch.mjs";

const line = (role, text, timestamp) => `${JSON.stringify({ type: "message", timestamp, message: { role, content: [{ type: "text", text }] } })}\n`;
const profile = (id, name, isolated) => {
  mkdirSync(join(root, "agent/profiles", id), { recursive: true });
  writeFileSync(join(root, "agent/profiles", id, "agent.json"), JSON.stringify({ name, model: "a/b", folder: id, uid: 2001, isolated }));
};
profile("helper", "Helper", false);
profile("money", "Money", true);
mkdirSync(join(root, "agent/sessions/helper"), { recursive: true });
mkdirSync(join(root, "isolated-sessions/money"), { recursive: true });
writeFileSync(join(root, "agent/sessions/helper/s.jsonl"), line("user", "Book the dentist in Pune for Friday", "2026-10-10T10:00:00Z"));
writeFileSync(join(root, "isolated-sessions/money/s.jsonl"), line("assistant", "The user's dentist bills go to the HSA card", "2026-10-11T10:00:00Z"));
mkdirSync(join(root, "knowledge/Topics"), { recursive: true });
writeFileSync(join(root, "knowledge/Topics/Health.md"), "---\nsources: [isolated:money@2026-10-11]\n---\n# Health\nDentist: Dr. Rao in Pune.\n");
openIndex(":memory:");

test("a query finds vault pages and chats, and marks what an isolated agent said", async () => {
  const text = await fetchKnowledge({ query: "dentist pune" });
  assert.match(text, /^<found>/);
  assert.match(text, /Vault Topics\/Health\.md "Health" \(sources: isolated:money@2026-10-11\)/);
  assert.match(text, /Helper, 2026-10-10, the user: Book the dentist/);
  assert.match(text, /Money \(isolated: its own report, unchecked\), 2026-10-11, agent:/);
});

test("a source gives that chat's day, also when written as isolated:", async () => {
  assert.match(await fetchKnowledge({ source: "isolated:money@2026-10-11" }), /HSA card/);
  await assert.rejects(fetchKnowledge({ source: "money@yesterday" }), { status: 404 });
});

test("an agent alone gives its newest messages", async () => {
  assert.match(await fetchKnowledge({ agent: "helper" }), /Book the dentist/);
  await assert.rejects(fetchKnowledge({ agent: "nobody" }), { status: 404 });
  await assert.rejects(fetchKnowledge({}), { status: 400 });
});
