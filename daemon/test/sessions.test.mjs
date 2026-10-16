import { root } from "./root.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { earlierOf } from "../agents/sessions.mjs";

const line = (id, role, text) => `${JSON.stringify({ type: "message", id, message: { role, content: [{ type: "text", text }] } })}\n`;
const compaction = (kept) => `${JSON.stringify({ type: "compaction", firstKeptEntryId: kept })}\n`;
const dir = join(root, "agent/sessions/c3");
mkdirSync(dir, { recursive: true });
const texts = async () => (await earlierOf("c3")).messages.map((m) => m.content[0].text);

test("earlier messages are the ones before the last compaction", async () => {
  writeFileSync(join(dir, "1.jsonl"), line("a", "user", "one") + line("b", "assistant", "two") + compaction("b") + line("c", "user", "three"));
  assert.deepEqual(await texts(), ["one"]);
});

test("a new chat file keeps the older files as earlier messages", async () => {
  writeFileSync(join(dir, "2.jsonl"), line("d", "user", "four"));
  assert.deepEqual(await texts(), ["one", "two", "three"]);
  writeFileSync(join(dir, "2.jsonl"), line("d", "user", "four") + line("e", "assistant", "five") + compaction("e"));
  assert.deepEqual(await texts(), ["one", "two", "three", "four"]);
});

test("earlier messages follow a chat file that grows", async () => {
  assert.deepEqual(await texts(), ["one", "two", "three", "four"]);
  writeFileSync(join(dir, "3.jsonl"), line("f", "user", "six") + line("g", "assistant", "seven"));
  assert.deepEqual(await texts(), ["one", "two", "three", "four", "five"]);
});
