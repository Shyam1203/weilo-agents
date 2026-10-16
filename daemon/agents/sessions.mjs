import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { CHATS, openChat } from "../common.mjs";
import { linkImages } from "./images.mjs";
import { CHAT_CHUNK, CHAT_TAIL, EARLIER_KEPT, EARLIER_KEPT_MS, EARLIER_PAGE, PREVIEW_CHARS, PREVIEW_TAIL } from "../config.mjs";

export const textOf = (content, between = "") => (typeof content === "string" ? content : (content ?? []).filter((b) => b.type === "text").map((b) => b.text).join(between));

const SKILL = /^<skill name="([^"]+)"[^>]*>[\s\S]*?<\/skill>\s*/;
const typed = (text) => text.replace(SKILL, (_, name) => `/${name} `).trimEnd();

export function asTyped(message) {
  if (message?.role !== "user") return message;
  const { content } = message;
  return { ...message, content: typeof content === "string" ? typed(content) : content.map((b) => (b.type === "text" ? { ...b, text: typed(b.text) } : b)) };
}

export async function chatFiles(id) {
  const found = await Promise.all(CHATS.map(async (top) => (await readdir(join(top, id)).catch(() => [])).filter((f) => f.endsWith(".jsonl")).sort().map((f) => join(top, id, f))));
  return found.flat();
}

const previews = new Map();
export async function lastMessage(id) {
  const path = (await chatFiles(id)).at(-1);
  const info = path && (await stat(path).catch(() => null));
  if (!info) return null;
  const key = `${path}:${info.size}:${info.mtimeMs}`;
  if (previews.get(id)?.key !== key) previews.set(id, { key, last: readLast(path) });
  return previews.get(id).last;
}

async function readLast(path) {
  const file = await openChat(path).catch(() => null);
  if (!file) return null;
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - PREVIEW_TAIL);
    const tail = Buffer.alloc(size - start);
    await file.read(tail, 0, tail.length, start);
    const lines = tail.toString("utf8").split("\n");
    if (start) lines.shift();
    for (const line of lines.reverse()) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const { role, content, timestamp } = asTyped(entry.message) ?? {};
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


async function* linesOf(file) {
  const handle = await openChat(file).catch(() => null);
  if (!handle) return;
  try {
    const { size } = await handle.stat();
    if (!size) return;
    const start = Math.max(0, size - CHAT_TAIL);
    let cut = start > 0;
    let rest = "";
    for await (const chunk of handle.createReadStream({ start, end: size - 1, encoding: "utf8", highWaterMark: CHAT_CHUNK, autoClose: false })) {
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

// "routine" was the tool for timed tasks in older versions: its results still show in their chats.
export const shown = (m) => m?.role === "user" || m?.role === "assistant" || m?.role === "compactionSummary" || (m?.role === "toolResult" && ["ask", "action", "routine", "manage_agents"].includes(m.toolName));
// Of a tool call the app draws a show card and an ask in full; of the others one line (the command,
// the path, the address...), so their arguments are cut to those fields: a file an agent writes is
// not sent to the app.
const DRAWN = new Set(["show", "ask"]);
const DETAIL = ["command", "action", "url", "text", "path", "file_path", "pattern", "query", "name"];
const DETAIL_CHARS = 300;
export function briefCall(block) {
  if (block?.type !== "toolCall" || DRAWN.has(block.name) || !block.arguments || typeof block.arguments !== "object") return block;
  const kept = DETAIL.flatMap((key) => (typeof block.arguments[key] === "string" ? [[key, block.arguments[key].slice(0, DETAIL_CHARS)]] : []));
  return { ...block, arguments: Object.fromEntries(kept) };
}

export const slim = (m) => (Array.isArray(m.content) && m.role === "assistant" ? { ...m, content: m.content.filter((b) => b.type !== "thinking").map(briefCall) } : m);

async function readEarlier(files) {
  const entries = [];
  let kept = null;
  let before = 0;
  for (const file of files) {
    if (file === files.at(-1)) [before, kept] = [entries.length, null];
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
      else entries.push({ id: entry.id, message: shown(entry.message) ? linkImages(slim(asTyped(entry.message))) : null });
    }
  }
  const end = kept ? entries.findIndex((e, i) => i >= before && e.id === kept) : before;
  return entries.slice(0, Math.max(0, end)).flatMap((e) => (e.message ? [e.message] : []));
}

const earlierRead = new Map();
export async function earlierOf(id, skip = 0) {
  const files = await chatFiles(id);
  const key = (await Promise.all(files.map((f) => stat(f).then((s) => `${f}:${s.size}:${s.mtimeMs}`, () => f)))).join("|");
  for (const [agent, kept] of earlierRead) if (Date.now() - kept.used > EARLIER_KEPT_MS) earlierRead.delete(agent);
  let read = earlierRead.get(id);
  if (read?.key !== key) read = { key, earlier: readEarlier(files) };
  read.used = Date.now();
  earlierRead.delete(id);
  earlierRead.set(id, read);
  read.earlier.catch(() => earlierRead.get(id) === read && earlierRead.delete(id));
  if (earlierRead.size > EARLIER_KEPT) earlierRead.delete(earlierRead.keys().next().value);
  const earlier = await read.earlier;
  const stop = Math.max(0, earlier.length - skip);
  const start = Math.max(0, stop - EARLIER_PAGE);
  return { messages: earlier.slice(start, stop), more: start > 0 };
}
