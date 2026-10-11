// Everything the UI knows about pi's conversation format: its messages and events, how events
// build up the conversation, and how the conversation reads as your messages and the agent's.
import { blocksOf, type Block as Shown } from "./blockData";

// What pi sends, as far as the UI reads it.
interface Block {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  /** With `toolCall`. */
  id?: string;
  name?: string;
  arguments?: unknown;
}

interface PiMessage {
  role: string;
  content: string | Block[];
  timestamp?: number;
  stopReason?: string;
  errorMessage?: string;
  /** With role `toolResult`. */
  toolCallId?: string;
  toolName?: string;
  /** With role `toolResult`: what a tool of ours says about what it did. */
  details?: { action?: string; title?: string };
}

/** A question the agent waits on, as pi asks it: a choice when there are options, else a line of text. */
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
}

/** An event from the server's stream: pi's own, plus `history` (the conversation so far) and `exit`. */
export interface PiEvent extends Partial<Asking> {
  type: string;
  method?: string;
  /** With `history`: the question the agent waits on. */
  asking?: Asking | null;
  messages?: PiMessage[];
  /** With `history`: a run is going. */
  busy?: boolean;
  message?: PiMessage;
  /** With `tool_execution_start`: the tool. */
  toolName?: string;
  error?: string;
  assistantMessageEvent?: StreamEvent;
  /** With `queue_update`: the messages sent during a run that wait for it to take them, the whole queue each time. */
  steering?: string[];
  followUp?: string[];
  /** With `compaction_end`: the summary was made (not aborted or failed). */
  result?: unknown;
}

interface Conversation {
  /** The history has arrived. */
  ready: boolean;
  messages: PiMessage[];
  busy: boolean;
  /** The last message has started and not ended (it is still arriving). */
  open: boolean;
  asking: Asking | null;
  /** Messages you sent during a run that it has not taken yet. */
  queued: string[];
  /** Why pi stopped, when it did not stop on its own. */
  exit?: string;
}

export const empty: Conversation = { ready: false, messages: [], busy: false, open: false, asking: null, queued: [] };

// Your messages and the agent's, and the answers to its questions (they show with the question).
const shows = (m: PiMessage) => m.role === "user" || m.role === "assistant" || (m.role === "toolResult" && (m.toolName === "ask" || m.toolName === "routine"));

const textOf = (content: PiMessage["content"] | undefined) => (typeof content === "string" ? content : (content ?? []).map((b) => b.text ?? "").join(""));

// Applies one streaming event to the assistant message in progress, the last one. Only text is
// kept; the finished message replaces it.
function stream(messages: PiMessage[], e: StreamEvent): PiMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || typeof last.content === "string") return messages;
  const [kind, step] = e.type.split("_");
  const content = [...last.content];
  const block = content[e.contentIndex];
  if (step === "start") content[e.contentIndex] = { type: kind, text: "" };
  else if (kind === "text" && block) content[e.contentIndex] = { ...block, text: step === "delta" ? (block.text ?? "") + e.delta : e.content };
  else return messages;
  return [...messages.slice(0, -1), { ...last, content }];
}

// A message is in the list once: the same one arriving again (a stream that joined mid-message, say) is not added.
const has = (messages: PiMessage[], m: PiMessage) => m.role !== "toolResult" && m.timestamp !== undefined && messages.some((x) => x.role === m.role && x.timestamp === m.timestamp);

export function reduce(state: Conversation, e: PiEvent): Conversation {
  const { message } = e;
  switch (e.type) {
    case "history":
      return { ready: true, messages: (e.messages ?? []).filter(shows), busy: !!e.busy, open: false, asking: e.asking ?? null, queued: [] };
    case "queue_update":
      return { ...state, queued: [...(e.steering ?? []), ...(e.followUp ?? [])] };
    case "extension_ui_request":
      // Only the agent's own questions reach the chat.
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
    // A viewer that joined during a message has not seen it start: it shows once it ends.
    case "message_update":
      return state.open && e.assistantMessageEvent ? { ...state, messages: stream(state.messages, e.assistantMessageEvent) } : state;
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

/** Why the last turn failed, if it did (a bad key, say). */
export function failureOf({ messages }: Conversation) {
  const last = messages.at(-1);
  return last?.role === "assistant" && last.stopReason === "error" ? last.errorMessage : undefined;
}

/** A line under the chat when the last turn ended without an answer: stopped, or nothing came back (a failure or exit has its own alert). */
export function noteOf({ busy, exit, messages }: Conversation) {
  const last = messages.at(-1);
  if (busy || exit || !last) return undefined;
  if (last.role === "user") return "No reply. Try again, or choose another model in Edit agent.";
  return last.stopReason === "aborted" ? "Stopped." : undefined;
}

// What the chat shows.
export interface Message {
  kind: "message";
  id: string;
  role: "human" | "agent";
  text: string;
  /** Pictures sent with it, as data URLs. */
  images: string[];
  at: number | null;
}

const imagesOf = (content: PiMessage["content"]) => (typeof content === "string" ? [] : content.filter((b) => b.type === "image").map((b) => `data:${b.mimeType};base64,${b.data}`));

/** What the agent put on show with the `show` tool. */
interface ShownBlocks {
  kind: "show";
  id: string;
  role: "agent";
  blocks: Shown[];
  at: number | null;
}

/** A question the agent asked, with your answer once you gave it. */
export interface Question {
  kind: "ask";
  id: string;
  role: "agent";
  question: string;
  options: string[];
  answer?: string;
  at: number | null;
}

/** Something that happened in the chat, in a line: a routine ran, or the agent changed one. */
export interface Note {
  kind: "note";
  id: string;
  role: "agent";
  text: string;
  at: number | null;
}

export type Item = Message | ShownBlocks | Question | Note;

// A routine's task reaches the agent as a message that starts with this (daemon/routines/routines.mjs).
const ROUTINE_MARK = "⏰ Routine: ";

// What the `routine` tool did, as a line for the chat (the tool's result carries it in `details`).
function routineNote(details: PiMessage["details"]) {
  if (details?.action === "create") return `Routine added: ${details.title}`;
  if (details?.action === "update") return `Routine changed: ${details.title}`;
  return details?.action === "delete" ? "Routine deleted" : null;
}

/** Your messages, the agent's answers and what it shows; what it does between them (thinking, other tools, and what it says about them) is not shown, and an answer appears when it is complete. */
export function itemsOf({ messages, open }: Conversation): Item[] {
  const results = new Map(messages.flatMap((m) => (m.role === "toolResult" && m.toolCallId ? [[m.toolCallId, m] as const] : [])));
  return messages.flatMap((m, i): Item[] => {
    const at = m.timestamp ? m.timestamp / 1000 : null;
    if (m.role === "user") {
      const text = textOf(m.content);
      if (text.startsWith(ROUTINE_MARK)) return [{ kind: "note", id: `${i}`, role: "agent", text: `Routine: ${text.slice(ROUTINE_MARK.length).split("\n")[0]}`, at }];
      return [{ kind: "message", id: `${i}`, role: "human", text, images: imagesOf(m.content), at }];
    }
    if (m.role !== "assistant" || typeof m.content === "string") return [];
    // Text that comes with a call to a tool the chat does not show ("Let me scroll down:") is the agent working, not its answer.
    // A message still arriving may turn out to be that, so its text waits until it ends.
    const arriving = open && i === messages.length - 1;
    const working = arriving || m.content.some((b) => b.type === "toolCall" && b.name !== "show" && b.name !== "ask");
    return m.content.flatMap((b, j): Item[] => {
      if (b.type === "text") return working ? [] : [{ kind: "message", id: `${i}.${j}`, role: "agent", text: b.text ?? "", images: [], at }];
      if (b.type === "toolCall" && b.name === "show") return [{ kind: "show", id: `${i}.${j}`, role: "agent", blocks: blocksOf(b.arguments), at }];
      if (b.type === "toolCall" && b.name === "ask") {
        const { question, options } = (b.arguments ?? {}) as { question?: unknown; options?: unknown };
        return [{ kind: "ask", id: `${i}.${j}`, role: "agent", question: String(question ?? ""), options: Array.isArray(options) ? options.map(String) : [], answer: b.id && results.has(b.id) ? textOf(results.get(b.id)!.content) : undefined, at }];
      }
      if (b.type === "toolCall" && b.name === "routine") {
        const text = routineNote(b.id ? results.get(b.id)?.details : undefined);
        return text ? [{ kind: "note", id: `${i}.${j}`, role: "agent", text, at }] : [];
      }
      return [];
    });
  });
}
