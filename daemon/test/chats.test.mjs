import { root } from "./root.mjs";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { after, agentsWithChats, containing, newest, onDate, openIndex, withAny } from "../agents/chats.mjs";

const line = (role, text, timestamp) => `${JSON.stringify({ type: "message", timestamp, message: { role, content: [{ type: "text", text }] } })}\n`;
const regular = join(root, "agent/sessions/a1/s.jsonl");
const isolated = join(root, "isolated-sessions/b2/s.jsonl");
mkdirSync(join(root, "agent/sessions/a1"), { recursive: true });
mkdirSync(join(root, "isolated-sessions/b2"), { recursive: true });
openIndex(":memory:");

test("the index finds what was said, by text, words, day and time", async () => {
  writeFileSync(regular, line("user", "My home Server runs Ubuntu", "2026-10-10T10:00:00Z") + line("assistant", "Noted the server", "2026-10-10T10:01:00Z") + '{"type":"model_change"}\nnot json\n');
  writeFileSync(isolated, line("user", "⏰ Routine: check the bank", "2026-10-11T09:00:00Z"));
  assert.deepEqual((await containing("SERV", 10)).map((m) => m.body), ["Noted the server", "My home Server runs Ubuntu"]);
  assert.deepEqual((await withAny(["ubuntu", "bank", "is"], null, 10)).map((m) => [m.agent, m.isolated, m.speaker]), [["b2", 1, "routine"], ["a1", 0, "you"]]);
  assert.equal((await onDate("a1", "2026-10-10")).length, 2);
  assert.equal((await after("a1", "2026-10-10T10:00:00Z")).length, 1);
  assert.deepEqual(await agentsWithChats(), [{ id: "a1", isolated: false }, { id: "b2", isolated: true }]);
  assert.equal((await containing("100%_", 10)).length, 0);
});

test("only complete lines count, and a chat file that shrinks or goes is read again", async () => {
  const half = line("user", "half a line", "2026-10-12T00:00:00Z");
  appendFileSync(regular, half.slice(0, 25));
  assert.equal((await newest("a1", 10)).length, 2);
  appendFileSync(regular, half.slice(25));
  assert.equal((await newest("a1", 10)).at(-1).body, "half a line");
  writeFileSync(regular, line("user", "rewritten", "2026-10-13T00:00:00Z"));
  assert.deepEqual((await newest("a1", 10)).map((m) => m.body), ["rewritten"]);
  rmSync(join(root, "isolated-sessions/b2"), { recursive: true });
  assert.equal((await containing("bank", 10)).length, 0);
});
