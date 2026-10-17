import { memo, useCallback, useRef, useState, type ReactNode } from "react";
import { longWhen } from "../../lib/format";
import { AgentText } from "./AgentText";
import { AskCard } from "./AskCard";
import { Icon } from "../../components/ui/Icon";
import { useCopy } from "../../lib/useCopy";
import type { Draft } from "./Composer";
import { Action, ReplyActions, Time } from "./ReplyActions";
import { ShowBlocks } from "./ShowBlocks";
import { StepsLine } from "./StepsLine";
import type { Asking, Item, Message, Queued } from "./conversation";

const GAP = 30 * 60;
const DRAWN = 12;

interface Props {
  messages: Item[];
  busy: boolean;
  asking: Asking | null;
  onAnswer: (value?: string) => Promise<void>;
  onReply: (message: string) => void;
  onRetry: (message: Draft) => void;
  onEdit: (message: Draft) => void;
  queued: Queued[];
  onUnqueue: (queued: Queued) => Promise<void>;
  onPins?: (title: string) => void;
  extras?: { at: number; key: string; node: ReactNode }[];
  note?: ReactNode;
  working?: ReactNode;
}

const draftOf = (m: Message): Draft => ({ text: m.text, images: m.images });

export function MessageList({ messages, busy, asking, onAnswer, onReply, onRetry, onEdit, queued, onUnqueue, onPins, extras = [], note, working }: Props) {
  const shown = messages.filter((m) => (m.kind === "ask" ? m.answer !== undefined || !asking : m.kind === "show" || m.kind === "steps" || m.role === "human" || m.text.trim()));
  const replyTo = useRef(onReply);
  replyTo.current = onReply;
  const reply = useCallback((text: string) => replyTo.current(text), []);
  const actions = useRef({ onRetry, onEdit, onPins });
  actions.current = { onRetry, onEdit, onPins };
  const showPins = useCallback((title: string) => actions.current.onPins?.(title), []);
  const retryWith = useCallback((m: Message) => actions.current.onRetry(draftOf(m)), []);
  const edit = useCallback((m: Message) => actions.current.onEdit(draftOf(m)), []);

  const isHuman = (m?: Item) => m?.kind === "message" && m.role === "human";
  const chosen: (string | undefined)[] = [];
  for (let i = shown.length - 1, after: string | undefined; i >= 0; i--) {
    chosen[i] = after;
    if (isHuman(shown[i])) after = (shown[i] as Message).text;
  }
  const last = shown.findLast((m): m is Message => isHuman(m));
  const again = !busy && !asking && last && (last.text || last.images.length) ? last : undefined;

  const later = [...extras].sort((a, b) => a.at - b.at);
  let next = 0;
  let shownAt = 0;
  let said: string[] = [];
  return (
    <ol aria-live="polite" aria-relevant="additions" className="flex flex-col gap-1.5">
      {shown.map((item, i) => {
        const before: ReactNode[] = [];
        while (next < later.length && item.at !== null && later[next].at <= item.at) {
          const extra = later[next++];
          before.push(<Extra key={extra.key}>{extra.node}</Extra>);
        }
        const label = item.at && item.at - shownAt > GAP ? longWhen(item.at) : null;
        if (label) shownAt = item.at!;
        if (item.kind === "message") (item.role === "human" ? (said = []) : said.push(item.text.trim()));
        const ends = item.kind === "message" && item.role !== "human" && (i === shown.length - 1 ? !busy : isHuman(shown[i + 1]));
        return [
          ...before,
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
            latest={item === last}
            onReply={reply}
            onRetry={retryWith}
            onEdit={edit}
            onPins={onPins && showPins}
          />,
        ];
      })}
      {later.slice(next).map((x) => (
        <Extra key={x.key}>{x.node}</Extra>
      ))}
      {working && <li className="mt-1.5 pl-1">{working}</li>}
      {queued.map((q, i) => (
        <li key={`queued-${q.when}-${q.text}-${queued.slice(0, i).filter((x) => x.when === q.when && x.text === q.text).length}`} className="mt-1.5 animate-fade-in">
          <QueuedMessage queued={q} onRemove={() => onUnqueue(q)} onEdit={() => onUnqueue(q).then(() => onEdit({ text: q.text, images: [] }))} />
        </li>
      ))}
      {asking && (
        <li className="mt-2.5 animate-fade-in">
          <AskCard question={asking.title} options={asking.options} secret={asking.secret} onAnswer={onAnswer} />
        </li>
      )}
      {note && (
        <li className="mt-2.5 animate-fade-in">
          {typeof note === "string" ? <p className="text-center text-xs text-ink-3">{note}</p> : note}
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
  retry?: Message;
  latest: boolean;
  onReply: (message: string) => void;
  onRetry: (message: Message) => void;
  onEdit: (message: Message) => void;
  onPins?: (title: string) => void;
}

const Row = memo(function Row({ item, label, spaced, far, chosen, replyable, working, ending, retry, latest, onReply, onRetry, onEdit, onPins }: RowProps) {
  return (
    <li data-at={item.at ?? undefined} className={`animate-fade-in ${spaced ? "mt-2.5" : ""} ${far ? "[content-visibility:auto] [contain-intrinsic-size:auto_120px]" : ""}`}>
      {label && <p className="mt-4 mb-2.5 text-center text-xs font-medium text-ink-3">{label}</p>}
      {item.kind === "ask" ? <AskCard question={item.question} options={item.options} answer={item.answer} /> : item.kind === "note" ? item.pin && onPins ? <button type="button" onClick={() => onPins(item.pin!)} className="mx-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-ink-2 ring-1 ring-line hover:bg-select"><Icon name="pin" size={12} /> {item.text} <Icon name="chevronRight" size={11} /></button> : <p className="flex items-center justify-center gap-1.5 py-1 text-xs text-ink-3"><Icon name={item.pin ? "pin" : item.text.startsWith("Action") ? "bolt" : item.text.includes(" ran by itself") ? "clock" : "check"} size={12} /> {item.text}</p> : item.kind === "summary" ? <p title="The agent now has a summary of the messages above, not the messages themselves." className="flex items-center gap-3 py-1 text-xs text-ink-3 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">{item.text}</p> : item.kind === "steps" ? <StepsLine steps={item.steps} working={working} /> : item.kind === "show" ? <ShowBlocks blocks={item.blocks} streaming={item.streaming} chosen={chosen} onReply={replyable ? onReply : undefined} /> : item.role === "human" ? <HumanMessage message={item} latest={latest} onEdit={() => onEdit(item)} /> : <AgentText text={item.text} />}
      {ending !== undefined && <ReplyActions text={ending} at={item.at} onRetry={retry ? () => onRetry(retry) : undefined} />}
    </li>
  );
});

const Extra = ({ children }: { children: ReactNode }) => <li className="mt-2.5 animate-fade-in">{children}</li>;

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

function QueuedMessage({ queued, onRemove, onEdit }: { queued: Queued; onRemove: () => Promise<void>; onEdit: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const run = (action: () => Promise<void>) => (setBusy(true), void action().catch(() => setBusy(false)));
  return (
    <div className={`flex flex-col items-end gap-1 ${busy ? "opacity-50" : ""}`}>
      <p className="max-w-[85%] rounded-2xl bg-bubble-me/60 px-3.5 py-2 text-[14.5px] leading-relaxed whitespace-pre-wrap text-on-bubble-me [overflow-wrap:anywhere]">{queued.text}</p>
      <span className="flex items-center gap-1 text-xs text-ink-3">
        <Icon name="clock" size={11} /> {queued.when === "later" ? "Queued, the agent reads it when it finishes" : "Queued, the agent reads it next"}
        <span className="ml-1 flex text-ink-3">
          <Action icon="edit" label="Edit this message" onClick={() => !busy && run(onEdit)} />
          <Action icon="close" label="Don't send this message" onClick={() => !busy && run(onRemove)} />
        </span>
      </span>
    </div>
  );
}

function HumanMessage({ message, latest, onEdit }: { message: Message; latest: boolean; onEdit: () => void }) {
  const { copied, copy } = useCopy();
  return (
    <div className="group flex flex-col items-end gap-1.5">
      {message.action && (
        <span className="flex items-center gap-1 text-xs font-medium text-ink-2">
          <Icon name="bolt" size={12} /> {message.action}
        </span>
      )}
      {message.images.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {message.images.map((url, i) => (
            <img key={i} src={url} alt={`Image ${i + 1}`} className="max-h-56 max-w-[16rem] rounded-2xl object-cover" />
          ))}
        </div>
      )}
      {message.text && <p className="max-w-[85%] rounded-2xl bg-bubble-me px-3.5 py-2 text-[14.5px] leading-relaxed whitespace-pre-wrap text-on-bubble-me [overflow-wrap:anywhere]">{message.text}</p>}
      <div className="-mt-1 flex items-center gap-0.5 text-ink-3">
        <span className={`flex gap-0.5 transition-opacity focus-within:opacity-100 ${latest ? "" : "opacity-0 group-hover:opacity-100"}`}>
          {message.text && <Action icon={copied ? "check" : "copy"} label={copied ? "Copied" : "Copy"} onClick={() => void copy(message.text)} />}
          <Action icon="edit" label="Edit in the message box" onClick={onEdit} />
        </span>
        {message.at ? <Time at={message.at} className="ml-1 pr-1" /> : null}
      </div>
    </div>
  );
}
