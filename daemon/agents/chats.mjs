import { open, readdir, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { CHATS, ISOLATED_SESSIONS, RUN } from "../common.mjs";
import { asTyped } from "./sessions.mjs";

const CHUNK = 1 << 20;
const ROLE = /"role":"(user|assistant)"/;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, done INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, file TEXT NOT NULL, agent TEXT NOT NULL, speaker TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL, isolated INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS messages_agent ON messages (agent, at);
  CREATE INDEX IF NOT EXISTS messages_file ON messages (file);
  CREATE VIRTUAL TABLE IF NOT EXISTS words USING fts5(body, content = 'messages', content_rowid = 'id', tokenize = 'trigram case_sensitive 0');
  CREATE TRIGGER IF NOT EXISTS messages_in AFTER INSERT ON messages BEGIN INSERT INTO words (rowid, body) VALUES (new.id, new.body); END;
  CREATE TRIGGER IF NOT EXISTS messages_out AFTER DELETE ON messages BEGIN INSERT INTO words (words, rowid, body) VALUES ('delete', old.id, old.body); END;
`;

let db = null;
export function openIndex(path = join(RUN, "chats.db")) {
  db?.close();
  db = new DatabaseSync(path);
  db.exec(SCHEMA);
}

const textOf = (content) => (typeof content === "string" ? content : (content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n"));

export function said(line) {
  if (!ROLE.test(line.slice(0, 300))) return null;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  const message = asTyped(entry.message);
  const body = textOf(message?.content).trim();
  if (!body || (message.role !== "user" && message.role !== "assistant")) return null;
  return { speaker: message.role === "assistant" ? "agent" : body.startsWith("⏰ Routine:") ? "routine" : "you", at: String(entry.timestamp ?? ""), body };
}

async function chatFiles() {
  const found = [];
  for (const top of CHATS) {
    for (const agent of await readdir(top).catch(() => [])) {
      for (const name of await readdir(join(top, agent)).catch(() => [])) if (name.endsWith(".jsonl")) found.push({ path: join(top, agent, name), agent, isolated: top === ISOLATED_SESSIONS ? 1 : 0 });
    }
  }
  return found;
}

async function index({ path, agent, isolated }, from, size) {
  const insert = db.prepare("INSERT INTO messages (file, agent, speaker, at, body, isolated) VALUES (?, ?, ?, ?, ?, ?)");
  const handle = await open(path);
  try {
    let done = from;
    let rest = Buffer.alloc(0);
    for (let at = from; at < size; at += CHUNK) {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(Math.min(CHUNK, size - at)), 0, Math.min(CHUNK, size - at), at);
      const data = Buffer.concat([rest, buffer.subarray(0, bytesRead)]);
      const end = data.lastIndexOf(10) + 1;
      rest = data.subarray(end);
      for (const line of data.subarray(0, end).toString("utf8").split("\n")) {
        const m = line && said(line);
        if (m) insert.run(path, agent, m.speaker, m.at, m.body, isolated);
      }
      done += end;
    }
    return done;
  } finally {
    await handle.close();
  }
}

async function sync() {
  if (!db) openIndex();
  const files = await chatFiles();
  const known = new Map(db.prepare("SELECT path, done FROM files").all().map((f) => [f.path, f.done]));
  db.exec("BEGIN");
  try {
    for (const path of known.keys()) {
      if (files.some((f) => f.path === path)) continue;
      db.prepare("DELETE FROM messages WHERE file = ?").run(path);
      db.prepare("DELETE FROM files WHERE path = ?").run(path);
    }
    for (const file of files) {
      const size = (await stat(file.path).catch(() => null))?.size ?? 0;
      let from = known.get(file.path) ?? 0;
      if (size < from) {
        db.prepare("DELETE FROM messages WHERE file = ?").run(file.path);
        from = 0;
      }
      if (size > from) db.prepare("INSERT OR REPLACE INTO files (path, done) VALUES (?, ?)").run(file.path, await index(file, from, size));
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

let syncing = null;
const synced = () => (syncing ??= sync().finally(() => (syncing = null)));

const COLUMNS = "agent, speaker, at, substr(at, 1, 10) AS date, body, isolated";
const query = async (sql, ...params) => (await synced(), db.prepare(sql).all(...params));
const phrase = (word) => `"${word.replaceAll('"', '""')}"`;

export const containing = (text, limit) => query(`SELECT ${COLUMNS} FROM messages WHERE id IN (SELECT rowid FROM words WHERE body LIKE ? ESCAPE '\\') ORDER BY at DESC LIMIT ?`, `%${text.replace(/[\\%_]/g, "\\$&")}%`, limit);

export const withAny = (words, agent, limit) => {
  const long = words.filter((w) => w.length >= 3);
  if (!long.length) return Promise.resolve([]);
  return query(`SELECT ${COLUMNS} FROM messages WHERE id IN (SELECT rowid FROM words WHERE words MATCH ?) ${agent ? "AND agent = ?" : ""} ORDER BY at DESC LIMIT ?`, long.map(phrase).join(" OR "), ...(agent ? [agent] : []), limit);
};

export const onDate = (agent, date) => query(`SELECT ${COLUMNS} FROM messages WHERE agent = ? AND at >= ? AND at < ? ORDER BY at`, agent, date, `${date}~`);
export const newest = async (agent, limit) => (await query(`SELECT ${COLUMNS} FROM messages WHERE agent = ? ORDER BY at DESC LIMIT ?`, agent, limit)).reverse();
export const after = (agent, at) => query(`SELECT ${COLUMNS} FROM messages WHERE agent = ? AND at > ? ORDER BY at`, agent, at);
export const agentsWithChats = async () => (await query("SELECT DISTINCT agent, isolated FROM messages")).map(({ agent, isolated }) => ({ id: agent, isolated: isolated === 1 }));
