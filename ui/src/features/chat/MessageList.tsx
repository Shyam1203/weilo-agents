import { useState } from "react";
import { longWhen } from "../../lib/format";
import { AgentText } from "./AgentText";
import { AskCard } from "./AskCard";
import { Icon } from "../../components/ui/Icon";
import { useCopy } from "../../lib/useCopy";
import type { Draft } from "./Composer";
import { Action, ReplyActions } from "./ReplyActions";
import { ShowBlocks } from "./ShowBlocks";
import { StepsLine } from "./StepsLine";
import type { Asking, Item, Message, Queued } from "./conversation";

const GAP = 30 * 60;

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
  note?: string;
}

const draftOf = (m: Message): Draft => ({ text: m.text, images: m.images });

export function MessageList({ messages, busy, asking, onAnswer, onReply, onRetry, onEdit, queued, onUnqueue, note }: Props) {
  const shown = messages.filter((m) => (m.kind === "ask" ? m.answer !== undefined || !asking : m.kind === "show" || m.kind === "steps" || m.role === "human" || m.text.trim()));
  let shownAt = 0;

  const answerTo = (i: number) => {
    const chosen = shown.slice(i + 1).find((m): m is Message => m.kind === "message" && m.role === "human")?.text;
    return { chosen, onReply: chosen === undefined && !busy ? onReply : undefined };
  };

  const isHuman = (m?: Item) => m?.kind === "message" && m.role === "human";
  const endsReply = (i: number) => shown[i].kind === "message" && !isHuman(shown[i]) && (i === shown.length - 1 ? !busy : isHuman(shown[i + 1]));
  const replyText = (i: number) => {
    const parts: string[] = [];
    for (let j = i; j >= 0; j--) {
      const m = shown[j];
      if (m.kind !== "message") continue;
      if (m.role === "human") break;
      parts.unshift(m.text.trim());
    }
    return parts.join("\n\n");
  };
  const last = shown.findLast((m): m is Message => m.kind === "message" && m.role === "human");
  const again = !busy && !asking && last && (last.text || last.images.length) ? last : undefined;

  return (
    <ol aria-live="polite" aria-relevant="additions" className="flex flex-col gap-1.5">
      {shown.map((message, i) => {
        const label = message.at && message.at - shownAt > GAP ? longWhen(message.at) : null;
        if (label) shownAt = message.at!;
        const sameSide = shown[i - 1]?.role === message.role;
        return (
          <li key={message.id} data-at={message.at ?? undefined} className={`animate-fade-in ${sameSide || label ? "" : "mt-2.5"}`}>
            {label && <p className="mt-4 mb-2.5 text-center text-xs font-medium text-ink-3">{label}</p>}
            {message.kind === "ask" ? <AskCard question={message.question} options={message.options} answer={message.answer} /> : message.kind === "note" ? <p className="flex items-center justify-center gap-1.5 py-1 text-xs text-ink-3"><Icon name="clock" size={12} /> {message.text}</p> : message.kind === "summary" ? <p title="The agent now has a summary of the messages above, not the messages themselves." className="flex items-center gap-3 py-1 text-xs text-ink-3 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">{message.text}</p> : message.kind === "steps" ? <StepsLine steps={message.steps} working={busy && i === shown.length - 1} /> : message.kind === "show" ? <ShowBlocks blocks={message.blocks} streaming={message.streaming} {...answerTo(i)} /> : message.role === "human" ? <HumanMessage message={message} latest={message === last} onEdit={() => onEdit(draftOf(message))} /> : <AgentText text={message.text} />}
            {endsReply(i) && <ReplyActions text={replyText(i)} onRetry={i === shown.length - 1 && again ? () => onRetry(draftOf(again)) : undefined} />}
          </li>
        );
      })}
      {queued.map((q, i) => (
        <li key={`queued-${q.when}-${q.text}-${queued.slice(0, i).filter((x) => x.when === q.when && x.text === q.text).length}`} className="mt-1.5 animate-fade-in">
          <QueuedMessage queued={q} onRemove={() => onUnqueue(q)} onEdit={() => onUnqueue(q).then(() => onEdit({ text: q.text, images: [] }))} />
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
      {message.images.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {message.images.map((url, i) => (
            <img key={i} src={url} alt={`Image ${i + 1}`} className="max-h-56 max-w-[16rem] rounded-2xl object-cover" />
          ))}
        </div>
      )}
      {message.text && <p className="max-w-[85%] rounded-2xl bg-bubble-me px-3.5 py-2 text-[14.5px] leading-relaxed whitespace-pre-wrap text-on-bubble-me [overflow-wrap:anywhere]">{message.text}</p>}
      <div className={`-mt-1 flex gap-0.5 text-ink-3 transition-opacity focus-within:opacity-100 ${latest ? "" : "opacity-0 group-hover:opacity-100"}`}>
        {message.text && <Action icon={copied ? "check" : "copy"} label={copied ? "Copied" : "Copy"} onClick={() => void copy(message.text)} />}
        <Action icon="edit" label="Edit in the message box" onClick={onEdit} />
      </div>
    </div>
  );
}
