// The conversation: your messages on the right, the agent's on the left, and the time between turns.
import { longWhen } from "../../lib/format";
import { AgentText } from "./AgentText";
import { AskCard } from "./AskCard";
import { Icon } from "../../components/ui/Icon";
import { ShowBlocks } from "./ShowBlocks";
import type { Asking, Item, Message } from "./conversation";

/** A new time label when this much passes between messages. */
const GAP = 30 * 60;

interface Props {
  messages: Item[];
  busy: boolean;
  /** The question the agent waits on. */
  asking: Asking | null;
  /** Answers it; no value skips it. */
  onAnswer: (value?: string) => Promise<void>;
  /** Sends a reply (a pressed button). */
  onReply: (message: string) => void;
  /** How the last turn ended, when it ended without an answer. */
  note?: string;
}

export function MessageList({ messages, busy, asking, onAnswer, onReply, note }: Props) {
  // A model can say nothing but a blank line before it uses a tool: no empty bubble for it.
  // A question still open shows at the end, as the one you answer.
  const shown = messages.filter((m) => (m.kind === "ask" ? m.answer !== undefined || !asking : m.kind === "show" || m.role === "human" || m.text.trim()));
  let shownAt = 0;

  // What you replied after the blocks at `i`; until you do, they can be answered (not while the agent works).
  const answerTo = (i: number) => {
    const chosen = shown.slice(i + 1).find((m): m is Message => m.kind === "message" && m.role === "human")?.text;
    return { chosen, onReply: chosen === undefined && !busy ? onReply : undefined };
  };

  return (
    <ol aria-live="polite" aria-relevant="additions" className="flex flex-col gap-1.5">
      {shown.map((message, i) => {
        const label = message.at && message.at - shownAt > GAP ? longWhen(message.at) : null;
        if (label) shownAt = message.at!;
        const sameSide = shown[i - 1]?.role === message.role;
        return (
          <li key={message.id} className={`animate-fade-in ${sameSide || label ? "" : "mt-2.5"}`}>
            {label && <p className="mt-4 mb-2.5 text-center text-xs font-medium text-ink-3">{label}</p>}
            {message.kind === "ask" ? <AskCard question={message.question} options={message.options} answer={message.answer} /> : message.kind === "note" ? <p className="flex items-center justify-center gap-1.5 py-1 text-xs text-ink-3"><Icon name="clock" size={12} /> {message.text}</p> : message.kind === "show" ? <ShowBlocks blocks={message.blocks} {...answerTo(i)} /> : message.role === "human" ? <HumanMessage message={message} /> : <AgentText text={message.text} />}
          </li>
        );
      })}
      {asking && (
        <li className="mt-2.5 animate-fade-in">
          <AskCard question={asking.title} options={asking.options} onAnswer={onAnswer} />
        </li>
      )}
      {note && (
        <li className="mt-2.5 animate-fade-in">
          <p className="text-center text-xs text-ink-3">{note}</p>
        </li>
      )}
    </ol>
  );
}

function HumanMessage({ message }: { message: Message }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      {message.images.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {message.images.map((url, i) => (
            <img key={i} src={url} alt={`Image ${i + 1}`} className="max-h-56 max-w-[16rem] rounded-2xl object-cover" />
          ))}
        </div>
      )}
      {message.text && <p className="max-w-[85%] rounded-2xl bg-bubble-me px-3.5 py-2 text-[14.5px] leading-relaxed whitespace-pre-wrap text-on-bubble-me [overflow-wrap:anywhere]">{message.text}</p>}
    </div>
  );
}
