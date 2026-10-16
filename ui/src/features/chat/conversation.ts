import { blocksOf, type Block as Shown } from "./blockData";
import { partialJson } from "./partialJson";

interface Block {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  url?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  json?: string;
}

export interface PiMessage {
  role: string;
  content: string | Block[];
  timestamp?: number;
  stopReason?: string;
  errorMessage?: string;
  toolCallId?: string;
  toolName?: string;
  details?: { action?: string; op?: string; title?: string; note?: string };
  summary?: string;
}

export interface Asking {
  id: string;
  title: string;
  options?: string[];
}

interface StreamEvent {
  type: string;
  contentIndex: number;
  delta?: string;
  content?: string;
  id?: string;
  toolName?: string;
  toolCall?: Block;
}

export interface PiEvent extends Partial<Asking> {
  type: string;
  method?: string;
  asking?: Asking | null;
  messages?: PiMessage[];
  busy?: boolean;
  message?: PiMessage;
  toolName?: string;
  error?: string;
  assistantMessageEvent?: StreamEvent;
  steering?: string[];
  followUp?: string[];
  result?: unknown;
  more?: boolean;
}

interface Conversation {
  ready: boolean;
  messages: PiMessage[];
  busy: boolean;
  open: boolean;
  asking: Asking | null;
  queued: Queued[];
  exit?: string;
  earlier: PiMessage[];
  more: boolean;
}

export interface Queued {
  text: string;
  when: "now" | "later";
}

export const empty: Conversation = { ready: false, messages: [], busy: false, open: false, asking: null, queued: [], earlier: [], more: false };

const shows = (m: PiMessage) => m.role === "user" || m.role === "assistant" || m.role === "compactionSummary" || (m.role === "toolResult" && (m.toolName === "ask" || m.toolName === "routine" || m.toolName === "manage_agents" || m.toolName === "action" || m.toolName === "pin"));

const textOf = (content: PiMessage["content"] | undefined) => (typeof content === "string" ? content : (content ?? []).map((b) => b.text ?? "").join(""));

function stream(messages: PiMessage[], e: StreamEvent): PiMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || typeof last.content === "string") return messages;
  const [kind, step] = e.type.split("_");
  const content = [...last.content];
  // The app is sent only tool calls as a reply is written; the text before one comes with message_end.
  while (content.length < e.contentIndex) content.push({ type: "text", text: "" });
  const block = content[e.contentIndex];
  if (kind === "toolcall") {
    // Only show is drawn while its arguments arrive; other tools wait for the whole call.
    if (step === "start") content[e.contentIndex] = { type: "toolCall", id: e.id, name: e.toolName, arguments: {}, json: "" };
    else if (step === "delta" && block?.name === "show") content[e.contentIndex] = { ...block, json: block.json + (e.delta ?? ""), arguments: partialJson(block.json + (e.delta ?? "")) ?? block.arguments };
    else if (step === "end" && e.toolCall) content[e.contentIndex] = e.toolCall;
    else return messages;
  } else if (step === "start") content[e.contentIndex] = { type: kind, text: "" };
  else if (kind === "text" && block) content[e.contentIndex] = { ...block, text: step === "delta" ? (block.text ?? "") + e.delta : e.content };
  else return messages;
  return [...messages.slice(0, -1), { ...last, content }];
}

const has = (messages: PiMessage[], m: PiMessage) => m.role !== "toolResult" && m.timestamp !== undefined && messages.some((x) => x.role === m.role && x.timestamp === m.timestamp);

export function reduce(state: Conversation, e: PiEvent): Conversation {
  const { message } = e;
  switch (e.type) {
    case "history": {
      const messages = (e.messages ?? []).filter(shows);
      return { ready: true, messages, busy: !!e.busy, open: false, asking: e.asking ?? null, queued: [], earlier: [], more: e.more ?? messages[0]?.role === "compactionSummary" };
    }
    case "earlier":
      return { ...state, earlier: [...(e.messages ?? []), ...state.earlier], more: !!e.more };
    case "queue_update":
      return { ...state, queued: [...(e.steering ?? []).map((text): Queued => ({ text, when: "now" })), ...(e.followUp ?? []).map((text): Queued => ({ text, when: "later" }))] };
    case "extension_ui_request":
      return (e.method === "select" || e.method === "input") && e.id ? { ...state, asking: { id: e.id, title: e.title ?? "", options: e.options } } : state;
    case "ask_end":
      return { ...state, asking: null };
    case "agent_start":
      return { ...state, busy: true };
    case "agent_settled":
      return { ...state, busy: false, asking: null, queued: [] };
    case "message_start":
      if (!message || !shows(message) || has(state.messages, message)) return state;
      return { ...state, messages: [...state.messages, message], busy: state.busy || message.role === "user", open: true };
    case "message_update": {
      const messages = state.open && e.assistantMessageEvent ? stream(state.messages, e.assistantMessageEvent) : state.messages;
      return messages === state.messages ? state : { ...state, messages };
    }
    case "message_end": {
      if (!message || !shows(message)) return state;
      const messages = state.open ? state.messages.slice(0, -1) : state.messages;
      return { ...state, messages: has(messages, message) ? messages : [...messages, message], open: false };
    }
    case "exit":
      return { ...state, busy: false, asking: null, exit: e.error || undefined };
    default:
      return state;
  }
}

export function failureOf({ messages }: Conversation) {
  const last = messages.at(-1);
  return last?.role === "assistant" && last.stopReason === "error" ? last.errorMessage : undefined;
}

export const NO_REPLY = "No reply came.";

export function noteOf({ busy, exit, messages }: Conversation) {
  const last = messages.at(-1);
  if (busy || exit || !last) return undefined;
  if (last.role === "user") return NO_REPLY;
  return last.stopReason === "aborted" ? "Stopped." : undefined;
}

// What every row of the chat has.
interface ItemBase {
  id: string;
  at: number | null;
}

export interface Message extends ItemBase {
  kind: "message";
  role: "human" | "agent";
  text: string;
  images: string[];
  /** Sent by tapping this action. */
  action?: string;
}

const imagesOf = (content: PiMessage["content"]) => (typeof content === "string" ? [] : content.filter((b) => b.type === "image" && (b.url || b.data)).map((b) => b.url ?? `data:${b.mimeType};base64,${b.data}`));

interface ShownBlocks extends ItemBase {
  kind: "show";
  role: "agent";
  blocks: Shown[];
  streaming: boolean;
}

export interface Question extends ItemBase {
  kind: "ask";
  role: "agent";
  question: string;
  options: string[];
  answer?: string;
}

export interface Note extends ItemBase {
  kind: "note";
  role: "agent";
  text: string;
  /** A line about a pin: it opens the pins. */
  pins?: true;
}

interface Summary extends ItemBase {
  kind: "summary";
  role: "agent";
  text: string;
}

interface Steps extends ItemBase {
  kind: "steps";
  role: "agent";
  steps: Step[];
}

export interface Step {
  tool: string;
  detail: string;
}

export type Item = Message | ShownBlocks | Question | Note | Steps | Summary;

function detailOf(tool: string, args: unknown) {
  const a = (args ?? {}) as Record<string, unknown>;
  const first = (...keys: string[]) => keys.map((k) => a[k]).find((v): v is string => typeof v === "string" && !!v.trim()) ?? "";
  if (tool === "bash") return first("command").split("\n")[0];
  if (tool === "browser") return [first("action"), first("url", "text")].filter(Boolean).join(" ");
  return first("path", "file_path", "pattern", "query", "url", "action", "name");
}

const joined = (items: Item[]) =>
  items.reduce<Item[]>((all, item) => {
    const last = all.at(-1);
    if (item.kind === "steps" && last?.kind === "steps") all[all.length - 1] = { ...last, steps: [...last.steps, ...item.steps] };
    else all.push(item);
    return all;
  }, []);

// Older versions sent timed tasks with this mark; they show like actions that ran by themselves.
const OLD_SCHEDULED_MARK = "⏰ Routine: ";
// Kept in step with the daemon's ACTION_MARK, CONFIRM_NOTE and BY_ITSELF (actions/actions.mjs).
const ACTION_MARK = "⚡ Action: ";
const CONFIRM_NOTE = "\n\nBefore you pay, order, book or send anything, use ask to confirm the exact details with the user.";
const BY_ITSELF = " · ran by itself";
// An action that keeps pins fresh ends with this line, for the agent only (PIN_NOTE).
const PIN_NOTE = /\n\nThen update its pin with the pin tool: [^\n]*$/;

function actionNote(details: PiMessage["details"]) {
  const verb = { create: "Action saved", update: "Action changed", delete: "Action deleted" }[details?.op ?? ""];
  return verb && details?.title ? `${verb}: ${details.title}` : null;
}

function pinNote(details: PiMessage["details"]) {
  const verb = { pin: "Pinned", unpin: "Unpinned" }[details?.op ?? ""];
  return verb && details?.title ? `${verb}: ${details.title}` : null;
}



// Items of a message that has arrived are kept, so a new event redraws only what changed: the
// same item objects let the chat skip every other row.
const kept = new WeakMap<PiMessage, { i: number; deps: unknown[]; items: Item[] }>();
const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, k) => x === b[k]);

export function itemsOf({ messages: live, earlier, open }: Conversation): Item[] {
  const messages = [...earlier, ...live];
  const results = new Map(messages.flatMap((m) => (m.role === "toolResult" && m.toolCallId ? [[m.toolCallId, m] as const] : [])));
  return joined(messages.flatMap((m, n): Item[] => {
    const i = n - earlier.length;
    const arriving = open && n === messages.length - 1;
    if (arriving) return itemsFor(m, i, true, results);
    const deps = typeof m.content === "string" ? [] : m.content.flatMap((b) => (b.type === "toolCall" && b.id ? [results.get(b.id)] : []));
    const was = kept.get(m);
    if (was && was.i === i && same(was.deps, deps)) return was.items;
    const items = itemsFor(m, i, false, results);
    kept.set(m, { i, deps, items });
    return items;
  }));
}

function itemsFor(m: PiMessage, i: number, arriving: boolean, results: Map<string, PiMessage>): Item[] {
  const at = m.timestamp ? m.timestamp / 1000 : null;
  if (m.role === "compactionSummary") return [{ kind: "summary", id: `${i}`, role: "agent", text: "Summarized for the agent", at }];
  if (m.role === "user") {
    const text = textOf(m.content);
    if (text.startsWith(OLD_SCHEDULED_MARK)) return [{ kind: "note", id: `${i}`, role: "agent", text: `${text.slice(OLD_SCHEDULED_MARK.length).split("\n")[0]} ran by itself`, at }];
    if (text.startsWith(ACTION_MARK)) {
      const [title, ...rest] = text.slice(ACTION_MARK.length).replace(PIN_NOTE, "").replace(CONFIRM_NOTE, "").split("\n\n");
      if (title.endsWith(BY_ITSELF)) return [{ kind: "note", id: `${i}`, role: "agent", text: `${title.slice(0, -BY_ITSELF.length)} ran by itself`, at }];
      return [{ kind: "message", id: `${i}`, role: "human", text: rest.join("\n\n"), images: imagesOf(m.content), at, action: title }];
    }
    return [{ kind: "message", id: `${i}`, role: "human", text, images: imagesOf(m.content), at }];
  }
  if (m.role !== "assistant" || typeof m.content === "string") return [];
  const working = arriving || m.content.some((b) => b.type === "toolCall" && b.name !== "show" && b.name !== "ask");
  return m.content.flatMap((b, j): Item[] => {
    if (b.type === "text" && working && !arriving && b.text?.trim()) return [{ kind: "steps", id: `${i}.${j}`, role: "agent", steps: [{ tool: "say", detail: b.text.trim() }], at }];
    if (b.type === "text") return working ? [] : [{ kind: "message", id: `${i}.${j}`, role: "agent", text: b.text ?? "", images: [], at }];
    if (b.type === "toolCall" && b.name === "show") return [{ kind: "show", id: `${i}.${j}`, role: "agent", blocks: blocksOf(b.arguments), streaming: arriving, at }];
    if (b.type === "toolCall" && b.name === "ask") {
      const { question, options } = (b.arguments ?? {}) as { question?: unknown; options?: unknown };
      return [{ kind: "ask", id: `${i}.${j}`, role: "agent", question: String(question ?? ""), options: Array.isArray(options) ? options.map(String) : [], answer: b.id && results.has(b.id) ? textOf(results.get(b.id)!.content) : undefined, at }];
    }
    if (b.type === "toolCall" && b.name === "action") {
      const text = actionNote(b.id ? results.get(b.id)?.details : undefined);
      if (text) return [{ kind: "note", id: `${i}.${j}`, role: "agent", text, at }];
    }
    if (b.type === "toolCall" && b.name === "pin") {
      const text = pinNote(b.id ? results.get(b.id)?.details : undefined);
      if (text) return [{ kind: "note", id: `${i}.${j}`, role: "agent", text, at, pins: true }];
    }
    // "routine" was the older tool for timed tasks: its results read like an action's.
    if (b.type === "toolCall" && b.name === "routine") {
      const details = b.id ? results.get(b.id)?.details : undefined;
      const text = actionNote(details && { op: details.action, title: details.title ?? "a timed task" });
      return text ? [{ kind: "note", id: `${i}.${j}`, role: "agent", text, at }] : [];
    }
    const note = b.type === "toolCall" && b.name === "manage_agents" && b.id ? results.get(b.id)?.details?.note : undefined;
    if (note) return [{ kind: "note", id: `${i}.${j}`, role: "agent", text: note, at }];
    if (b.type === "toolCall" && b.name) return [{ kind: "steps", id: `${i}.${j}`, role: "agent", steps: [{ tool: b.name, detail: detailOf(b.name, b.arguments) }], at }];
    return [];
  });
}
