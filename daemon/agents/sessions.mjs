import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { CHATS } from "../common.mjs";
import { CHAT_TAIL, EARLIER_PAGE, PREVIEW_CHARS, PREVIEW_TAIL } from "../config.mjs";

const textOf = (content) => (typeof content === "string" ? content : (content ?? []).map((b) => b.text ?? "").join(""));

// Pi turns "/skill:name args" into the skill's text plus the args before the model sees it.
// Chats and the agent list show what was typed.
const SKILL = /^<skill name="([^"]+)"[^>]*>[\s\S]*?<\/skill>\s*/;
const typed = (text) => text.replace(SKILL, (_, name) => `/${name} `).trimEnd();

export function asTyped(message) {
  if (message?.role !== "user") return message;
  const { content } = message;
  return { ...message, content: typeof content === "string" ? typed(content) : content.map((b) => (b.type === "text" ? { ...b, text: typed(b.text) } : b)) };
}

// An agent's chat files (pi writes one JSON line per entry), oldest first, wherever its kind keeps them (agents.mjs
// `chatDirOf`; an id is in one of them). A deleted agent's kept chat has some too.
export async function chatFiles(id) {
  const found = await Promise.all(CHATS.map(async (top) => (await readdir(join(top, id)).catch(() => [])).filter((f) => f.endsWith(".jsonl")).sort().map((f) => join(top, id, f))));
  return found.flat();
}

// The newest user or assistant text of an agent's conversation, for the agent list (`shown`: it only showed
// something, so there is no text). Only the end of the newest chat file is read. Line breaks stay, so the list
// can tell a heading or a list item from what follows it.
export async function lastMessage(id) {
  const files = await chatFiles(id);
  if (!files.length) return null;
  // The chat may go while it is read (its agent is being deleted).
  const file = await open(files.at(-1)).catch(() => null);
  if (!file) return null;
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - PREVIEW_TAIL);
    const tail = Buffer.alloc(size - start);
    await file.read(tail, 0, tail.length, start);
    const lines = tail.toString("utf8").split("\n");
    if (start) lines.shift(); // cut mid-line
    for (const line of lines.reverse()) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const { role, content, timestamp } = asTyped(entry.message) ?? {};
      // An answer that is only something shown (a table, say) or a question still counts as a reply.
      const card = Array.isArray(content) ? content.find((b) => b.type === "toolCall" && (b.name === "show" || b.name === "ask")) : null;
      const text = (textOf(content) || (card?.name === "ask" ? (card.arguments?.question ?? "") : "")).replace(/[^\S\n]+/g, " ").trim();
      if ((role === "user" || role === "assistant") && (text || card)) {
        return { role, text: text.slice(0, PREVIEW_CHARS), shown: !text, at: Math.floor((timestamp ?? Date.parse(entry.timestamp)) / 1000) };
      }
    }
    return null;
  } finally {
    await file.close();
  }
}

const ROLE = /"role":"(user|assistant)"/;
// Chats are read a piece of this size at a time and searched as they are read, so a large chat is never in memory whole.
const CHUNK = 1 << 20;

const textBlocks = (content) => (typeof content === "string" ? content : (content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n"));

// The lines of the end of a chat file: chat files only grow, and browser pages make them large, so the last CHAT_TAIL bytes are enough.
async function* linesOf(file) {
  const handle = await open(file).catch(() => null);
  if (!handle) return;
  try {
    const { size } = await handle.stat();
    if (!size) return;
    const start = Math.max(0, size - CHAT_TAIL);
    let cut = start > 0; // the first line starts before what is read
    let rest = "";
    for await (const chunk of handle.createReadStream({ start, end: size - 1, encoding: "utf8", highWaterMark: CHUNK, autoClose: false })) {
      if (!chunk.includes("\n")) {
        rest += chunk;
        continue;
      }
      const lines = (rest + chunk).split("\n");
      rest = lines.pop();
      for (const line of lines) {
        if (cut) cut = false;
        else yield line;
      }
    }
    if (!cut) yield rest;
  } finally {
    await handle.close();
  }
}

// What the chat shows of an earlier message: your messages and the agent's without its thinking (never shown), and of the
// tools' results only the answers to its questions and what a routine or a change it was always allowed did (the rest,
// such as a browser's screenshots, is what makes a chat file large).
const shown = (m) => m?.role === "user" || m?.role === "assistant" || (m?.role === "toolResult" && ["ask", "routine", "manage_agents"].includes(m.toolName));
const slim = (m) => (Array.isArray(m.content) && m.role === "assistant" ? { ...m, content: m.content.filter((b) => b.type !== "thinking") } : m);

/**
 * The messages pi summarized away (it keeps a summary in their place, and the messages from `firstKeptEntryId` on), newest
 * last: the page that ends `skip` messages before them. `more`: there are older ones still.
 */
export async function earlierOf(id, skip = 0) {
  const entries = [];
  let kept = null;
  for (const file of await chatFiles(id)) {
    for await (const raw of linesOf(file)) {
      const head = raw.slice(0, 120);
      if (!head.includes('"type":"message"') && !head.includes('"type":"compaction"')) continue;
      let entry;
      try {
        entry = JSON.parse(raw);
      } catch {
        continue;
      }
      if (entry.type === "compaction") kept = entry.firstKeptEntryId;
      else entries.push(entry);
    }
  }
  const end = kept ? entries.findIndex((e) => e.id === kept) : -1;
  const earlier = entries.slice(0, Math.max(0, end)).filter((e) => shown(e.message));
  const stop = Math.max(0, earlier.length - skip);
  const start = Math.max(0, stop - EARLIER_PAGE);
  return { messages: earlier.slice(start, stop).map((e) => slim(asTyped(e.message))), more: start > 0 };
}

/** The user's and the agent's messages of one chat folder, oldest first: { agent: name, id, speaker, at, date, body }. */
export async function* messagesOf(id, name) {
  for (const file of await chatFiles(id)) {
    for await (const raw of linesOf(file)) {
      if (!ROLE.test(raw.slice(0, 300))) continue;
      let entry;
      try {
        entry = JSON.parse(raw);
      } catch {
        continue;
      }
      const message = asTyped(entry.message);
      const text = textBlocks(message?.content).trim();
      if (!text || (message.role !== "user" && message.role !== "assistant")) continue;
      const speaker = message.role === "assistant" ? "agent" : text.startsWith("⏰ Routine:") ? "routine" : "you";
      const at = String(entry.timestamp ?? "");
      yield { agent: name, id, speaker, at, date: at.slice(0, 10), body: text };
    }
  }
}
