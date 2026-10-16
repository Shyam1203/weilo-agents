import { memo, useCallback, useRef } from "react";
import { longWhen } from "../../lib/format";
import { AgentText } from "./AgentText";
import { AskCard } from "./AskCard";
import { Icon } from "../../components/ui/Icon";
import { ReplyActions } from "./ReplyActions";
import { ShowBlocks } from "./ShowBlocks";
import { StepsLine } from "./StepsLine";
import type { Asking, Item, Message } from "./conversation";

const GAP = 30 * 60;
// The browser lays out and draws older messages only when they come near the screen.
const DRAWN = 12;

interface Props {
  messages: Item[];
  busy: boolean;
  asking: Asking | null;
  onAnswer: (value?: string) => Promise<void>;
  onReply: (message: string) => void;
  queued: string[];
  note?: string;
}

export function MessageList({ messages, busy, asking, onAnswer, onReply, queued, note }: Props) {
  const shown = messages.filter((m) => (m.kind === "ask" ? m.answer !== undefined || !asking : m.kind === "show" || m.kind === "steps" || m.role === "human" || m.text.trim()));
  const replyTo = useRef(onReply);
  replyTo.current = onReply;
  const reply = useCallback((text: string) => replyTo.current(text), []);

  const isHuman = (m?: Item) => m?.kind === "message" && m.role === "human";
  // What the user said after each item (the choice made on a card), from the end back.
  const chosen: (string | undefined)[] = [];
  for (let i = shown.length - 1, after: string | undefined; i >= 0; i--) {
    chosen[i] = after;
    if (isHuman(shown[i])) after = (shown[i] as Message).text;
  }
  const last = shown.findLast((m): m is Message => isHuman(m));
  const again = !busy && !asking && last?.text && !last.images.length ? last.text : undefined;

  let shownAt = 0;
  let said: string[] = [];
  return (
    <ol aria-live="polite" aria-relevant="additions" className="flex flex-col gap-1.5">
      {shown.map((item, i) => {
        const label = item.at && item.at - shownAt > GAP ? longWhen(item.at) : null;
        if (label) shownAt = item.at!;
        if (item.kind === "message") (item.role === "human" ? (said = []) : said.push(item.text.trim()));
        const ends = item.kind === "message" && item.role !== "human" && (i === shown.length - 1 ? !busy : isHuman(shown[i + 1]));
        return (
          <Row
            key={item.id}
            item={item}
            label={label}
            spaced={!(shown[i - 1]?.role === item.role || label)}
            far={i < shown.length - DRAWN}
            chosen={chosen[i]}
            replyable={chosen[i] === undefined && !busy}
            working={busy && i === shown.length - 1 && item.kind === "steps"}
            ending={ends ? said.join("\n\n") : undefined}
            retry={ends && i === shown.length - 1 ? again : undefined}
            onReply={reply}
          />
        );
      })}
      {queued.map((text, i) => (
        <li key={`queued-${i}`} className="mt-1.5 animate-fade-in">
          <div className="flex flex-col items-end gap-1">
            <p className="max-w-[85%] rounded-2xl bg-bubble-me/60 px-3.5 py-2 text-[14.5px] leading-relaxed whitespace-pre-wrap text-on-bubble-me [overflow-wrap:anywhere]">{text}</p>
            <span className="flex items-center gap-1 text-xs text-ink-3">
              <Icon name="clock" size={11} /> Queued, the agent reads it next
            </span>
          </div>
        </li>
      ))}
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

interface RowProps {
  item: Item;
  label: string | null;
  spaced: boolean;
  far: boolean;
  chosen?: string;
  replyable: boolean;
  working: boolean;
  ending?: string;
  retry?: string;
  onReply: (message: string) => void;
}

// A row draws again only when its own props change, so a new event redraws the newest message, not
// the whole chat.
const Row = memo(function Row({ item, label, spaced, far, chosen, replyable, working, ending, retry, onReply }: RowProps) {
  return (
    <li data-at={item.at ?? undefined} className={`animate-fade-in ${spaced ? "mt-2.5" : ""} ${far ? "[content-visibility:auto] [contain-intrinsic-size:auto_120px]" : ""}`}>
      {label && <p className="mt-4 mb-2.5 text-center text-xs font-medium text-ink-3">{label}</p>}
      {item.kind === "ask" ? <AskCard question={item.question} options={item.options} answer={item.answer} /> : item.kind === "note" ? <p className="flex items-center justify-center gap-1.5 py-1 text-xs text-ink-3"><Icon name="clock" size={12} /> {item.text}</p> : item.kind === "summary" ? <p title="The agent now has a summary of the messages above, not the messages themselves." className="flex items-center gap-3 py-1 text-xs text-ink-3 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">{item.text}</p> : item.kind === "steps" ? <StepsLine steps={item.steps} working={working} /> : item.kind === "show" ? <ShowBlocks blocks={item.blocks} streaming={item.streaming} chosen={chosen} onReply={replyable ? onReply : undefined} /> : item.role === "human" ? <HumanMessage message={item} /> : <AgentText text={item.text} />}
      {ending !== undefined && <ReplyActions text={ending} onRetry={retry ? () => onReply(retry) : undefined} />}
    </li>
  );
});

export function LoadingChat() {
  const shapes = ["ml-auto h-10 w-1/2", "h-24 w-5/6", "ml-auto h-10 w-2/5", "h-16 w-2/3"];
  return (
    <div role="status" aria-label="Loading the chat" className="flex flex-col gap-4">
      {shapes.map((shape) => (
        <div key={shape} className={`animate-pulse rounded-2xl bg-bubble ${shape}`} />
      ))}
    </div>
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
