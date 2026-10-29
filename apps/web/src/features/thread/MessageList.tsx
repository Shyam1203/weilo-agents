import { memo, useMemo, useState, type ReactNode } from "react";
import { cx, timeOf } from "../../lib/format";
import { paths } from "../../lib/router";
import { authorName, findAgent, useApp, type Sending } from "../../lib/store";
import { showSteps } from "../../lib/steps";
import { buildBlocks, type AgentItem, type Block, type StepItem } from "../../lib/timeline";
import { Avatar } from "../../ui/Avatar";
import { CheckIcon, ChevronDownIcon, SpinnerIcon, StopIcon, XCircleIcon } from "../../ui/glyphs";
import { Link } from "../../ui/Link";
import { Markdown } from "../../ui/Markdown";
import { MoveDialog } from "../shell/dialogs";
import { EventCard } from "./EventCard";
import { Problem } from "./Problem";
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
  /** Under the last reply, before "Filed in" (a channel chat's sessions that need you). */
  tail?: ReactNode;
}

/** The conversation. Rows are memoised, so only the reply being written re-renders while it streams. */
export function MessageList({ threadId, agentId, kind, empty, faces = true, tail }: MessageListProps) {
  const events = useEvents(threadId);
  const stoppedAt = useApp((s) => s.stopped[threadId] ?? null);
  const blocks = useMemo(() => buildBlocks(events, agentId, stoppedAt), [events, agentId, stoppedAt]);
  const sending = useApp((s) => s.sending[threadId] ?? NO_SENDING);
  const variant = useVariant();
  const gap = variant === "phone" ? "gap-3" : kind === "session" ? "gap-4" : "gap-6";
  // "Filed in #channel · Move" goes once, at the very end, as in the mock.
  const filed = useMemo(() => {
    let last: string | null = null;
    for (const b of blocks) if (b.type === "agent") for (const it of b.items) if (it.type === "filed") last = it.channelId;
    return last;
  }, [blocks]);
  const phone = variant === "phone";
  const showFace = faces && !phone;

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
      {(tail || filed) && (
        // Part of the last reply: under its text, 12px below it.
        <div className={cx("flex gap-3", !phone && "-mt-3")}>
          {showFace && <span aria-hidden="true" className="w-8 shrink-0" />}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {tail}
            {filed && <Filed channelId={filed} threadId={threadId} canMove={kind === "chat"} />}
          </div>
        </div>
      )}
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

function AgentMeta({ agentId, at }: { agentId: string | null; at: string | null }) {
  const name = useApp((s) => authorName(s, agentId));
  return (
    <div className="text-caption text-text-tertiary">
      <span className="font-medium text-text">{name}</span>
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
  const shown = block.items.filter((it) => it.type !== "filed");
  const [first, ...rest] = shown;
  const lead = first?.type === "text" ? first : null;
  const items = lead ? rest : shown;
  const showFace = faces && !phone;
  const face = block.hasText && agent && showFace;
  if (shown.length === 0) return null;

  return (
    <div className={cx("row-cv flex", phone ? "flex-col gap-2" : "gap-3")}>
      {showFace && (face ? <Avatar name={agent.name} color={agent.color} size={32} /> : <span aria-hidden="true" className="w-8 shrink-0" />)}
      <div className={cx("flex min-w-0 flex-1 flex-col", phone ? "gap-2" : "gap-3")}>
        {lead && (
          <div className="flex flex-col gap-1">
            {(!phone || faces) && <AgentMeta agentId={block.agentId} at={block.at} />}
            <TextBody text={lead.text} />
          </div>
        )}
        {items.map((it) => (
          <Item key={it.key} item={it} threadId={threadId} kind={kind} agentId={block.agentId} />
        ))}
      </div>
    </div>
  );
});

/** An agent's words, drawn from Markdown (safely: no raw HTML). */
function TextBody({ text }: { text: string }) {
  const phone = useVariant() === "phone";
  return (
    <Markdown
      text={text}
      className={cx(phone && "w-fit max-w-[88%] rounded-xl border border-border bg-surface px-4 py-3")}
    />
  );
}

function Item({
  item,
  threadId,
  kind,
  agentId,
}: {
  item: AgentItem;
  threadId: string;
  kind: MessageListProps["kind"];
  agentId: string | null;
}) {
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
      return null; // shown once at the end of the list
    case "problem":
      return <Problem threadId={threadId} agentId={agentId} message={item.message} action={item.action} resolved={item.resolved} />;
    case "note":
      return <p className="m-0 text-body-sm text-text-secondary">{item.text}</p>;
  }
}

export function StepIcon({ status }: { status: StepItem["status"] }) {
  if (status === "done") return <CheckIcon className="shrink-0 text-success" />;
  if (status === "failed") return <XCircleIcon className="shrink-0 text-warning" />;
  if (status === "stopped") return <StopIcon className="shrink-0 text-text-tertiary" />;
  return <SpinnerIcon className="spin shrink-0 text-accent" />;
}

const STATUS_WORD = { done: "done", failed: "didn't work", running: "in progress", stopped: "stopped" };

/**
 * Steps in plain words ("Read a file", "Ran a command"). The files and commands, and any
 * look-ups that failed along the way, are one click away under Show details.
 */
function Steps({ steps }: { steps: StepItem[] }) {
  const { shown, details, failedLine } = useMemo(() => showSteps(steps), [steps]);
  return (
    <div className="flex flex-col gap-2">
      {shown.length > 0 && (
        <ul aria-label="Steps" className="m-0 flex list-none flex-col gap-2 p-0 text-body-sm text-text-secondary">
          {shown.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <StepIcon status={s.status} />
              <span className="min-w-0">{s.label}</span>
              {/* An icon alone doesn't say what happened: a step that ended early says so. */}
              {s.status === "stopped" || s.status === "failed" ? (
                <span className="shrink-0 text-text-tertiary">· {s.status === "stopped" ? "Not finished" : "Didn't work"}</span>
              ) : (
                <span className="sr-only">({STATUS_WORD[s.status]})</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {details.length > 0 && (
        <details className="group text-caption text-text-tertiary">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm font-medium hover:text-text-secondary [&::-webkit-details-marker]:hidden">
            <ChevronDownIcon size={12} className="shrink-0 -rotate-90 transition-transform duration-[120ms] group-open:rotate-0" />
            Show details
            {failedLine && (
              <span className="flex items-center gap-1 font-normal text-text-secondary">
                <span aria-hidden="true">·</span>
                <XCircleIcon size={12} className="shrink-0 text-warning" />
                {failedLine}
              </span>
            )}
          </summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
            {details.map((s) => (
              <li key={s.id} className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0">{s.label}</span>
                {s.detail && <code className="ellipsis rounded-sm bg-surface-muted px-1 text-text-secondary">{s.detail}</code>}
                {s.status === "failed" && <span className="shrink-0">· didn't work</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
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
            {(!phone || faces) && <AgentMeta agentId={agentId} at={null} />}
            <TextBody text={text} />
          </div>
        </div>
      )}
    </div>
  );
}
