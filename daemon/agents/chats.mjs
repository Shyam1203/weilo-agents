import { readdir, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { AGENT_DIR, CHATS, ISOLATED_SESSIONS, openChat } from "../common.mjs";
import { CHAT_CHUNK } from "../config.mjs";
import { asTyped, chatFiles, textOf } from "./sessions.mjs";

const ROLE = /"role":"(user|assistant)"/;

const startedByAction = (body) => body.startsWith("⚡ Action: ") || body.startsWith("⏰ Routine:");

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, done INTEGER NOT NULL, head TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, file TEXT NOT NULL, agent TEXT NOT NULL, speaker TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL, isolated INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS messages_agent ON messages (agent, at);
  CREATE INDEX IF NOT EXISTS messages_file ON messages (file);
  CREATE VIRTUAL TABLE IF NOT EXISTS words USING fts5(body, content = 'messages', content_rowid = 'id', tokenize = 'trigram case_sensitive 0');
  CREATE TRIGGER IF NOT EXISTS messages_in AFTER INSERT ON messages BEGIN INSERT INTO words (rowid, body) VALUES (new.id, new.body); END;
  CREATE TRIGGER IF NOT EXISTS messages_out AFTER DELETE ON messages BEGIN INSERT INTO words (words, rowid, body) VALUES ('delete', old.id, old.body); END;
`;

const INDEX_VERSION = 2;

let db = null;
let sql = null;
export function openIndex(path = join(AGENT_DIR, "index", "chats.db")) {
  db?.close();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    db = new DatabaseSync(path);
    if (db.prepare("PRAGMA user_version").get()?.user_version !== INDEX_VERSION) throw new Error("an older index");
    db.exec(SCHEMA);
  } catch {
    db?.close();
    for (const end of ["", "-journal", "-wal", "-shm"]) rmSync(`${path}${end}`, { force: true });
    db = new DatabaseSync(path);
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${INDEX_VERSION}`);
  }
  sql = {
    files: db.prepare("SELECT path, done, head FROM files"),
    insert: db.prepare("INSERT INTO messages (file, agent, speaker, at, body, isolated) VALUES (?, ?, ?, ?, ?, ?)"),
    forget: db.prepare("DELETE FROM messages WHERE file = ?"),
    drop: db.prepare("DELETE FROM files WHERE path = ?"),
    mark: db.prepare("INSERT OR REPLACE INTO files (path, done, head) VALUES (?, ?, ?)"),
  };
}


function said(line) {
  if (!ROLE.test(line.slice(0, 300))) return null;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  const message = asTyped(entry.message);
  const body = textOf(message?.content, "\n").trim();
  if (!body || (message.role !== "user" && message.role !== "assistant")) return null;
  return { speaker: message.role === "assistant" ? "agent" : startedByAction(body) ? "action" : "you", at: String(entry.timestamp ?? ""), body };
}

async function allChatFiles() {
  const agents = new Set((await Promise.all(CHATS.map((top) => readdir(top).catch(() => [])))).flat().filter((id) => /^[a-z0-9-]+$/.test(id)));
  const found = await Promise.all([...agents].map(async (agent) => (await chatFiles(agent)).map((path) => ({ path, agent, isolated: path.startsWith(ISOLATED_SESSIONS + sep) ? 1 : 0 }))));
  return found.flat();
}

async function index({ path, agent, isolated }, from, size) {
  const handle = await openChat(path).catch(() => null);
  if (!handle) return from;
  try {
    let done = from;
    let rest = Buffer.alloc(0);
    for (let at = from; at < size; at += CHAT_CHUNK) {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(Math.min(CHAT_CHUNK, size - at)), 0, Math.min(CHAT_CHUNK, size - at), at);
      const data = Buffer.concat([rest, buffer.subarray(0, bytesRead)]);
      const end = data.lastIndexOf(10) + 1;
      rest = data.subarray(end);
      for (const line of data.subarray(0, end).toString("utf8").split("\n")) {
        const m = line && said(line);
        if (m) sql.insert.run(path, agent, m.speaker, m.at, m.body, isolated);
      }
      done += end;
    }
    return done;
  } finally {
    await handle.close();
  }
}

const HEAD = 64;
const headOf = async (path) => {
  const handle = await openChat(path).catch(() => null);
  if (!handle) return "";
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(HEAD), 0, HEAD, 0);
    return buffer.subarray(0, bytesRead).toString("hex");
  } finally {
    await handle.close();
  }
};

async function sync() {
  if (!db) openIndex();
  const files = await allChatFiles();
  const sizes = await Promise.all(files.map((f) => stat(f.path).then((s) => s.size, () => 0)));
  const paths = new Set(files.map((f) => f.path));
  const known = new Map(sql.files.all().map((f) => [f.path, f]));
  db.exec("BEGIN");
  try {
    for (const path of known.keys()) {
      if (paths.has(path)) continue;
      sql.forget.run(path);
      sql.drop.run(path);
    }
    for (const [i, file] of files.entries()) {
      const size = sizes[i];
      const was = known.get(file.path);
      if (was && size === was.done) continue;
      const head = await headOf(file.path);
      let from = was?.done ?? 0;
      if (size < from || (was && !head.startsWith(was.head))) {
        sql.forget.run(file.path);
        from = 0;
      }
      sql.mark.run(file.path, size > from ? await index(file, from, size) : from, head);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

let syncing = null;
export const syncIndex = () => (syncing ??= sync().finally(() => (syncing = null)));

const COLUMNS = "agent, speaker, at, substr(at, 1, 10) AS date, body, isolated";
const query = async (text, ...params) => (await syncIndex(), db.prepare(text).all(...params));
const read = (text, ...params) => db.prepare(text).all(...params);
const phrase = (word) => `"${word.replaceAll('"', '""')}"`;

const like = (text) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

function holding(words) {
  const long = words.filter((w) => w.length >= 3);
  const short = words.filter((w) => w.length < 3);
  const where = [...(long.length ? ["id IN (SELECT rowid FROM words WHERE words MATCH ?)"] : []), ...short.map(() => "body LIKE ? ESCAPE '\\'")];
  return { where: `(${where.join(" OR ")})`, params: [...(long.length ? [long.map(phrase).join(" OR ")] : []), ...short.map(like)] };
}

export const containing = (text, agents, limit) => withAny([text], agents, limit);

export function withAny(words, agents, limit) {
  if (!words.length || agents?.length === 0) return Promise.resolve([]);
  const { where, params } = holding(words);
  const of = agents ? `AND agent IN (${agents.map(() => "?").join(", ")})` : "";
  return query(`SELECT ${COLUMNS} FROM messages WHERE ${where} ${of} ORDER BY at DESC LIMIT ?`, ...params, ...(agents ?? []), limit);
}

export function ranked(words, agents, limit) {
  const long = words.filter((w) => w.length >= 3);
  if (!long.length) return withAny(words, agents, limit);
  if (agents?.length === 0) return Promise.resolve([]);
  const of = agents ? `AND m.agent IN (${agents.map(() => "?").join(", ")})` : "";
  return query(
    `SELECT m.agent, m.speaker, m.at, substr(m.at, 1, 10) AS date, m.body, m.isolated FROM words JOIN messages m ON m.id = words.rowid WHERE words MATCH ? ${of} ORDER BY bm25(words) LIMIT ?`,
    long.map(phrase).join(" OR "), ...(agents ?? []), limit,
  );
}

export const onDate = (agent, date) => query(`SELECT ${COLUMNS} FROM messages WHERE agent = ? AND at >= ? AND at < ? ORDER BY at`, agent, date, `${date}~`);
export const newest = async (agent, limit) => (await query(`SELECT ${COLUMNS} FROM messages WHERE agent = ? ORDER BY at DESC LIMIT ?`, agent, limit)).reverse();
export const latest = (agent) => read("SELECT max(at) AS at FROM messages WHERE agent = ?", agent)[0]?.at ?? null;
export const after = (agent, at, limit = -1) => read(`SELECT ${COLUMNS} FROM messages WHERE agent = ? AND at > ? ORDER BY at LIMIT ?`, agent, at, limit);
export const agentsWithChats = async () => (await query("SELECT DISTINCT agent FROM messages")).map(({ agent }) => agent);
