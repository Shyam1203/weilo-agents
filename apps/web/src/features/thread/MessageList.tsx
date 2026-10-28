import { memo, useMemo, useState, type ReactNode } from "react";
import { send } from "../../lib/app";
import { cx, timeOf } from "../../lib/format";
import { paths } from "../../lib/router";
import { findAgent, useApp, type Sending } from "../../lib/store";
import { buildBlocks, type AgentItem, type Block, type StepItem } from "../../lib/timeline";
import type { AgentSummary } from "../../proto/AgentSummary";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { AlertIcon, CheckIcon, SpinnerIcon, XCircleIcon } from "../../ui/glyphs";
import { Link } from "../../ui/Link";
import { MoveDialog } from "../shell/dialogs";
import { EventCard } from "./EventCard";
import { useEvents, useVariant } from "./useThread";

const NO_SENDING: Sending[] = [];

export interface MessageListProps {
  threadId: string;
  /** The agent that answers in this thread, for turns that don't name one. */
  agentId: string | null;
  /** Thread kind, for the details label and the Move link. */
  kind: "agent" | "chat" | "session";
  empty?: ReactNode;
  /** Agent's own chat on a phone: bubbles without faces. */
  faces?: boolean;
}

/** The conversation. Rows are memoised, so only the reply being written re-renders while it streams. */
export function MessageList({ threadId, agentId, kind, empty, faces = true }: MessageListProps) {
  const events = useEvents(threadId);
  const blocks = useMemo(() => buildBlocks(events, agentId), [events, agentId]);
  const sending = useApp((s) => s.sending[threadId] ?? NO_SENDING);
  const variant = useVariant();
  const gap = variant === "phone" ? "gap-3" : kind === "session" ? "gap-4" : "gap-6";

  return (
    <div className={cx("flex flex-col", gap)}>
      {blocks.length === 0 && sending.length === 0 && empty}
      {blocks.map((b) =>
        b.type === "user" ? (
          <UserRow key={b.key} text={b.text} at={b.at} afterJob={b.when === "after_job"} />
        ) : (
          <AgentBlockRow key={b.key} block={b} threadId={threadId} kind={kind} faces={faces} />
        ),
      )}
      {sending.map((m) => (
        <UserRow key={m.id} text={m.text} at={null} />
      ))}
      <StreamingRow threadId={threadId} agentId={agentId} faces={faces} />
    </div>
  );
}

const UserRow = memo(function UserRow({ text, at, afterJob }: { text: string; at: string | null; afterJob?: boolean }) {
  const phone = useVariant() === "phone";
  return (
    <div className="row-cv flex flex-col items-end gap-1">
      {!phone || at === null ? (
        <span className="text-caption text-text-tertiary">
          You · {at ? timeOf(at) : "Sending…"}
          {afterJob ? " · After this job" : ""}
        </span>
      ) : null}
      <div className={cx("max-w-[80%] bg-surface-muted px-3 py-2 break-words whitespace-pre-wrap", phone ? "rounded-xl" : "rounded-lg")}>
        {text}
      </div>
    </div>
  );
});

function AgentMeta({ agent, at }: { agent: AgentSummary | undefined; at: string | null }) {
  return (
    <div className="text-caption text-text-tertiary">
      <span className="font-medium text-text">{agent?.name ?? "Session"}</span>
      {at ? ` · ${timeOf(at)}` : null}
    </div>
  );
}

const AgentBlockRow = memo(function AgentBlockRow({
  block,
  threadId,
  kind,
  faces,
}: {
  block: Extract<Block, { type: "agent" }>;
  threadId: string;
  kind: MessageListProps["kind"];
  faces: boolean;
}) {
  const agent = useApp((s) => findAgent(s, block.agentId));
  const phone = useVariant() === "phone";
  const [first, ...rest] = block.items;
  const lead = first?.type === "text" ? first : null;
  const items = lead ? rest : block.items;
  const showFace = faces && !phone;
  const face = block.hasText && agent && showFace;

  return (
    <div className={cx("row-cv flex", phone ? "flex-col gap-2" : "gap-3")}>
      {showFace && (face ? <Avatar name={agent.name} color={agent.color} size={32} /> : <span aria-hidden="true" className="w-8 shrink-0" />)}
      <div className={cx("flex min-w-0 flex-1 flex-col", phone ? "gap-2" : "gap-3")}>
        {lead && (
          <div className="flex flex-col gap-1">
            {(!phone || faces) && <AgentMeta agent={agent} at={block.at} />}
            <TextBody text={lead.text} />
          </div>
        )}
        {items.map((it) => (
          <Item key={it.key} item={it} threadId={threadId} kind={kind} />
        ))}
      </div>
    </div>
  );
});

function TextBody({ text }: { text: string }) {
  const phone = useVariant() === "phone";
  return (
    <div
      className={cx(
        "break-words whitespace-pre-wrap",
        phone && "w-fit max-w-[88%] rounded-xl border border-border bg-surface px-4 py-3",
      )}
    >
      {text}
    </div>
  );
}

function Item({ item, threadId, kind }: { item: AgentItem; threadId: string; kind: MessageListProps["kind"] }) {
  switch (item.type) {
    case "text":
      return <TextBody text={item.text} />;
    case "steps":
      return <Steps steps={item.steps} />;
    case "card":
      return (
        <EventCard
          card={item.card}
          decided={item.decided}
          threadId={threadId}
          detailsLabel={kind === "session" && item.card.kind === "approval" ? "Show the command" : "Show details"}
        />
      );
    case "filed":
      return <Filed channelId={item.channelId} threadId={threadId} canMove={kind === "chat"} />;
    case "problem":
      return <Problem threadId={threadId} message={item.message} action={item.action} />;
  }
}

export function StepIcon({ status }: { status: StepItem["status"] }) {
  if (status === "done") return <CheckIcon className="shrink-0 text-success" />;
  if (status === "failed") return <XCircleIcon className="shrink-0 text-warning" />;
  return <SpinnerIcon className="spin shrink-0 text-accent" />;
}

const STATUS_WORD = { done: "done", failed: "didn't work", running: "in progress" };

function Steps({ steps }: { steps: StepItem[] }) {
  return (
    <ul aria-label="Steps" className="m-0 flex list-none flex-col gap-2 p-0 text-body-sm text-text-secondary">
      {steps.map((s) => (
        <li key={s.id} className="flex items-center gap-2">
          <StepIcon status={s.status} />
          <span className="min-w-0">{s.title}</span>
          <span className="sr-only">({STATUS_WORD[s.status]})</span>
        </li>
      ))}
    </ul>
  );
}

function Filed({ channelId, threadId, canMove }: { channelId: string; threadId: string; canMove: boolean }) {
  const channel = useApp((s) => s.snapshot?.channels.find((c) => c.id === channelId));
  const [moving, setMoving] = useState(false);
  if (!channel) return null;
  return (
    <div className="text-caption text-text-tertiary">
      Filed in <Link href={paths.channel(channelId)}>#{channel.slug}</Link>
      {canMove && (
        <>
          {" · "}
          <button
            type="button"
            onClick={() => setMoving(true)}
            className="border-0 bg-transparent p-0 text-caption text-accent-text hover:underline"
          >
            Move
          </button>
          <MoveDialog open={moving} onClose={() => setMoving(false)} threadId={threadId} currentChannelId={channelId} />
        </>
      )}
    </div>
  );
}

function Problem({ threadId, message, action }: { threadId: string; message: string; action: string | null }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-body-sm text-text-secondary" role="note">
      <AlertIcon className="shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      {action && (
        <Button size="sm" onClick={() => void send(threadId, action)}>
          {action}
        </Button>
      )}
    </div>
  );
}

/** The reply being written. A live region, so screen readers hear it too. */
function StreamingRow({ threadId, agentId, faces }: { threadId: string; agentId: string | null; faces: boolean }) {
  const text = useApp((s) => s.feeds[threadId]?.streaming ?? null);
  const agent = useApp((s) => findAgent(s, agentId));
  const phone = useVariant() === "phone";
  return (
    <div aria-live="polite" aria-atomic="false" aria-label={text ? `${agent?.name ?? "Agent"} is writing` : undefined}>
      {text && (
        <div className={cx("flex", phone ? "flex-col gap-2" : "gap-3")}>
          {faces && !phone && <Avatar name={agent?.name ?? "?"} color={agent?.color} size={32} />}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {(!phone || faces) && <AgentMeta agent={agent} at={null} />}
            <TextBody text={text} />
          </div>
        </div>
      )}
    </div>
  );
}
