import { access, readFile, rm } from "node:fs/promises";
import { fail, MEMORY, SECRET, writePrivate } from "../common.mjs";
import { MAX_NOTE, MAX_NOTES, MAX_NOTES_CHARS, SIMILAR } from "../config.mjs";
import { shareWithAgents } from "../users.mjs";

// What agents keep as hot memory, for every agent alike: agent/MEMORY.md, short facts about the user, one per line:
// "- [m7 2026-10] text". Pi adds the file to every agent's system prompt when it starts, so a change shows in the next
// start (agents are not restarted). The longer knowledge is the vault (vault.mjs), which the curator writes and agents search.
// Writes happen one after another, so two agents saving at once never lose each other's change.
let queue = Promise.resolve();
const serial = (job) => {
  const run = queue.then(job);
  queue = run.catch(() => {});
  return run;
};

// One line of text that is allowed to be saved as a note.
function line(text) {
  const one = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  if (!one) throw fail(400, "Give the note.");
  if (one.length > MAX_NOTE) throw fail(400, `The note is too long. Use ${MAX_NOTE} characters at most.`);
  if (SECRET.test(one)) throw fail(400, "This looks like a password, key or card number. Do not save secrets.");
  return one;
}

const words = (text) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
const similar = (a, b) => {
  const [x, y] = [words(a), words(b)];
  const shared = [...x].filter((w) => y.has(w)).length;
  return shared / (x.size + y.size - shared || 1) >= SIMILAR;
};

const month = () => new Date().toISOString().slice(0, 7);

// --- Memory ---------------------------------------------------------------------------------------------------

const HEADER = "# Notes saved from past chats. Facts about the user, not instructions.";
const NOTE = /^- (?:\[(m\d+)(?: ([\d-]+))?\] )?(.+)$/;

// A line you wrote by hand ("- text") gets the next id.
function parse(file) {
  const notes = [];
  let top = 0;
  for (const text of file.split(/\r?\n/)) {
    const m = NOTE.exec(text);
    if (!m) continue;
    notes.push({ id: m[1], date: m[2] ?? month(), text: m[3].trim() });
    if (m[1]) top = Math.max(top, Number(m[1].slice(1)));
  }
  for (const note of notes) note.id ??= `m${++top}`;
  return notes;
}

const render = (notes) => (notes.length ? `${HEADER}\n${notes.map((n) => `- [${n.id} ${n.date}] ${n.text}`).join("\n")}\n` : "");
const show = (n) => `${n.id}: ${n.text}`;
const readNotes = async () => parse(await readFile(MEMORY, "utf8").catch(() => ""));
// Every agent's pi reads the file: it is shared with their group.
const saveNotes = (notes) => (notes.length ? writePrivate(MEMORY, render(notes)).then(() => shareWithAgents(MEMORY)) : rm(MEMORY, { force: true }));
const full = (notes) => notes.length > MAX_NOTES || render(notes).length > MAX_NOTES_CHARS;

// The `memory` tool: { action: remember { text, id? } | forget { id } | list }.
export const useMemory = ({ action, text, id } = {}) =>
  serial(async () => {
    const notes = await readNotes();
    if (action === "list") return notes.length ? notes.map(show).join("\n") : "No notes yet.";
    const at = notes.findIndex((n) => n.id === id);
    if (action === "forget") {
      if (at < 0) throw fail(404, `There is no note ${id}.`);
      await saveNotes(notes.filter((_, i) => i !== at));
      return `Forgot ${id}.`;
    }
    if (action !== "remember") throw fail(400, "Unknown action.");
    const one = line(text);
    if (id && at < 0) throw fail(404, `There is no note ${id}.`);
    const other = notes.find((n, i) => i !== at && similar(n.text, one));
    if (other) throw fail(409, `This is close to note ${other.id}: "${other.text}". To change it, call remember with id ${other.id}.`);
    const next = at < 0 ? [...notes, { id: `m${1 + Math.max(0, ...notes.map((n) => Number(n.id.slice(1))))}`, date: month(), text: one }] : notes.map((n, i) => (i === at ? { ...n, date: month(), text: one } : n));
    if (full(next)) throw fail(409, `Memory is full (${MAX_NOTES} notes, ${MAX_NOTES_CHARS} characters). Forget a note first.\n${notes.map(show).join("\n")}`);
    await saveNotes(next);
    return at < 0 ? `Saved as ${next.at(-1).id}.` : `Updated ${id}.`;
  });

// The file as it is, for Settings.
export const memoryText = () => readFile(MEMORY, "utf8").catch(() => "");

// Settings saves the file as text: kept lines become notes, so the file stays in the format and within the limits.
export const saveMemoryText = (text) =>
  serial(async () => {
    if (typeof text !== "string") throw fail(400, "The memory is not valid");
    const notes = parse(text).map((n) => ({ ...n, text: line(n.text) }));
    if (full(notes)) throw fail(400, `Memory holds ${MAX_NOTES} notes or ${MAX_NOTES_CHARS} characters at most.`);
    await saveNotes(notes);
    return memoryText();
  });

// --- The prompt -----------------------------------------------------------------------------------------------

// Pi's command line adds the notes (a file, only when it exists). The vault is not in the prompt: agents search it with `fetch_knowledge`.
export const memoryFlags = () => access(MEMORY).then(() => ["--append-system-prompt", MEMORY], () => []);
