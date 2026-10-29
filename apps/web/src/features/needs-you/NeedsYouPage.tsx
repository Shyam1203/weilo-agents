import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { decide, savePrefs, sayNoLater, send, showNotice, stopLater } from "../../lib/app";
import { cx, listWords, shortName, timeOf, whenLabel } from "../../lib/format";
import { actionable, approveKey, groupNeedsYou, isHeadsUp, isSmall, yesAction, type NeedsYouGroup } from "../../lib/needsYou";
import { navigate, threadPath } from "../../lib/router";
import { SECTION_TITLES, withSection, type SectionKey } from "../../lib/sidebar";
import { awayLine, hostAway, problemNeedsYou, store, useApp } from "../../lib/store";
import type { NeedsYouItem } from "../../proto/NeedsYouItem";
import type { Snapshot } from "../../proto/Snapshot";
import { Avatar, SessionMark } from "../../ui/Avatar";
import { Disclosure, EmptyState, TextWithCode, TopBar } from "../../ui/bits";
import { problemKind } from "../../lib/engines";
import { ProblemButton } from "../thread/Problem";
import { Button } from "../../ui/Button";
import { CheckIcon, CodeIcon, MoreIcon, XCircleIcon } from "../../ui/glyphs";
import { IconButton } from "../../ui/IconButton";
import { Menu, MenuItem } from "../../ui/Menu";
import type { CardAction } from "../../proto/CardAction";
import { Link } from "../../ui/Link";
import { RiskLine } from "../../ui/RiskLine";
import { decidedAt, outcomeWords } from "../../lib/timeline";
import type { Event } from "../../proto/Event";
import { ConnectionBanner } from "../shell/Toast";
import { useTouchOnly } from "../../lib/platform";

function pathFor(snap: Snapshot, item: NeedsYouItem): string {
  const t = snap.threads.find((x) => x.id === item.thread_id);
  return t ? threadPath(t) : "/";
}

/** Approvals, questions and failures, in one calm list. J/K move, Enter opens, A approves small items. */
export function NeedsYouPage({ phone }: { phone?: boolean }) {
  const snap = useApp((s) => s.snapshot)!;
  // Failures the host only sent as chat events are added here, under "Didn't work".
  const problems = useApp(problemNeedsYou);
  const groups = useMemo(() => groupNeedsYou([...snap.needs_you, ...problems]), [snap.needs_you, problems]);
  const order = useMemo(() => actionable(groups), [groups]);
  const [cursor, setCursor] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const touch = useTouchOnly();
  const hidden = (["agents", "channels", "sessions"] as SectionKey[]).filter((k) => !snap.prefs[k].shown);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, select, dialog, [role=menu]")) return;
      const key = e.key.toLowerCase();
      if (!["j", "k", "a", "enter"].includes(key) || order.length === 0) return;
      const i = order.findIndex((n) => n.approval_id === cursor);
      if (key === "j" || key === "k") {
        e.preventDefault();
        const next = order[key === "j" ? Math.min(order.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1)]!;
        setCursor(next.approval_id);
        rows.current.get(next.approval_id)?.focus();
        return;
      }
      const item = order[i];
      if (!item) return;
      if (key === "enter" && t?.tagName !== "BUTTON" && t?.tagName !== "A") {
        e.preventDefault();
        navigate(pathFor(snap, item));
      }
      if (key === "a") {
        e.preventDefault();
        if (awayLine(store.get())) return;
        const r = approveKey(item);
        if (r.kind === "decide" && r.action.decision) {
          // The cursor moves on to the next item, like reading down a list.
          const next = nextAfterApprove(order, i);
          void decide(item.approval_id, r.action.decision);
          if (next) {
            setCursor(next);
            requestAnimationFrame(() => rows.current.get(next)?.focus());
          }
        } else navigate(pathFor(snap, item));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [order, cursor, snap]);

  const register = (id: string) => (el: HTMLElement | null) => {
    if (el) rows.current.set(id, el);
    else rows.current.delete(id);
  };

  return (
    <main className={cx("flex min-h-0 min-w-0 flex-1 flex-col", phone ? "bg-bg" : "bg-surface")}>
      <TopBar className={phone ? "px-4" : "px-6"}>
        <h1 className={cx("m-0 flex-1 font-semibold", phone ? "text-title" : "text-title-sm")}>Needs you</h1>
        {!phone && !touch && (
          <span className="ellipsis text-caption text-text-tertiary">J / K to move · Enter to open · A to approve small items</span>
        )}
      </TopBar>
      <ConnectionBanner />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cx("flex w-full max-w-[768px] flex-col gap-6", phone ? "p-4" : "p-6")}>
          {hidden.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-body-sm text-text-secondary">
              <span>
                <b className="font-medium text-text">
                  {listWords(hidden.map((k) => SECTION_TITLES[k]))} {hidden.length === 1 ? "is" : "are"} hidden in your sidebar.
                </b>{" "}
                Their alerts still show here.
              </span>
              <Button
                size="sm"
                onClick={() => void savePrefs(hidden.reduce((p, k) => withSection(p, k, { shown: true }), snap.prefs))}
              >
                Show
              </Button>
            </div>
          )}
          {groups.length === 0 && <EmptyState title="Nothing needs you." line={pingLine(snap)} />}
          {groups.map((g) => (
            <Group
              key={g.key}
              group={g}
              snap={snap}
              cursor={cursor}
              setCursor={setCursor}
              register={register}
              phone={phone}
              awayNote={g.key === groups.find((x) => x.key === "waiting" || x.key === "questions")?.key}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function Group({
  group,
  snap,
  cursor,
  setCursor,
  register,
  phone,
  awayNote,
}: {
  group: NeedsYouGroup;
  snap: Snapshot;
  cursor: string | null;
  setCursor(id: string): void;
  register(id: string): (el: HTMLElement | null) => void;
  phone?: boolean;
  /** The first group of questions: says once, while the Weilo computer is away, that answers wait. */
  awayNote?: boolean;
}) {
  const id = `ny-${group.key}`;
  const away = useApp(awayLine);
  const rowProps = (item: NeedsYouItem) => ({
    ref: register(item.approval_id),
    selected: cursor === item.approval_id,
    onFocus: () => setCursor(item.approval_id),
  });
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="m-0 flex h-7 items-center text-caption font-medium text-text-tertiary">
        {group.title}
        {group.count !== null ? ` · ${group.count}` : ""}
      </h2>
      {/* The banner says why; this says it once for every card, not on each. */}
      {away && awayNote && (
        <p className="m-0 -mt-1 text-caption text-text-secondary">You can answer when your Weilo computer is back.</p>
      )}
      {group.key === "waiting" || group.key === "questions"
        ? group.items.map((item) => <AskRow key={item.approval_id} item={item} snap={snap} phone={phone} {...rowProps(item)} />)
        : group.key === "done"
          ? (
              <div className="rounded-lg border border-border bg-surface">
                {group.items.map((item, i) => (
                  <DoneRow key={item.approval_id} item={item} snap={snap} last={i === group.items.length - 1} phone={phone} {...rowProps(item)} />
                ))}
              </div>
            )
          : group.items.map((item) => <PastRow key={item.approval_id} item={item} snap={snap} expired={group.key === "expired"} phone={phone} {...rowProps(item)} />)}
    </section>
  );
}

interface RowProps {
  item: NeedsYouItem;
  snap: Snapshot;
  selected: boolean;
  onFocus(): void;
  ref: (el: HTMLElement | null) => void;
}

/** Where the cursor goes after A approves the item at `i`: the next item, else the one before. */
export function nextAfterApprove(order: NeedsYouItem[], i: number): string | null {
  return order[i + 1]?.approval_id ?? order[i - 1]?.approval_id ?? null;
}

/** "Ava will ping you…", or "Your agents will…" when there are several. */
export function pingLine(snap: Pick<Snapshot, "agents">): string {
  if (snap.agents.length > 1) return "Your agents will ping you if that changes.";
  const only = snap.agents[0];
  return `${only ? shortName(only.name) : "Your agent"} will ping you if that changes.`;
}

/** The agent an item belongs to: its thread's agent, else the agent that started its session. */
export function agentOf(snap: Snapshot, item: NeedsYouItem) {
  const thread = snap.threads.find((t) => t.id === item.thread_id);
  return (
    snap.agents.find((a) => a.id === thread?.agent_id) ??
    snap.agents.find((a) => a.main_thread_id === item.thread_id) ??
    snap.agents.find((a) => a.id === thread?.started_by || a.name === thread?.started_by)
  );
}

/** What "Ask again" sends, in the person's own words. */
export function askAgainText(title: string): string {
  return `Can you ask me again about ${title.trim().replace(/[.?!]+$/, "")}?`;
}

function Lead({ item, snap, selected }: { item: NeedsYouItem; snap: Snapshot; selected: boolean }) {
  const thread = snap.threads.find((t) => t.id === item.thread_id);
  if (thread?.kind === "session") return <SessionMark size={32} selected={selected} />;
  const agent = agentOf(snap, item) ?? snap.agents[0];
  return agent ? <Avatar name={agent.name} color={agent.color} size={32} selected={selected} /> : null;
}

/** "#shop-launch · Ava · 9:42" with the place as a link. */
function Source({ item, snap }: { item: NeedsYouItem; snap: Snapshot }) {
  const [place, ...rest] = item.source.split(" · ");
  return (
    <div className="ellipsis text-caption text-text-tertiary">
      <Link href={pathFor(snap, item)} tabIndex={-1}>
        {place}
      </Link>
      {rest.length ? ` · ${rest.join(" · ")}` : ""} · {timeOf(item.created_at)}
    </div>
  );
}

function AskRow({ item, snap, selected, onFocus, ref, phone }: RowProps & { phone?: boolean }) {
  const small = isSmall(item.card.risk);
  const yes = small ? yesAction(item.card.actions) : undefined;
  // The same choices as the card in the chat: Not now, and Always allow (under ⋯) wherever it offers one.
  const no = item.card.actions.find((a) => a.decision?.kind === "deny");
  const always = item.card.actions.find((a) => a.decision?.kind === "allow_always");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  // A yes for good on something that isn't small asks once more, like the chat card.
  const [confirming, setConfirming] = useState<CardAction | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  const open = () => navigate(pathFor(snap, item));
  // Answers wait while the Weilo computer can't be reached; the reason shows as one line.
  const away = useApp(awayLine);
  const act = async (a: CardAction) => {
    if (!a.decision || away) return;
    // A no can be taken back for a few seconds (Undo in the toast).
    if (a.decision.kind === "deny") {
      sayNoLater(item.approval_id, a.decision, item.card.kind === "draft");
      return;
    }
    if (!small && !confirming) {
      setConfirming(a);
      return;
    }
    setBusy(true);
    await decide(item.approval_id, a.decision);
    setBusy(false);
    setConfirming(null);
  };
  const size = phone ? "phone" : "md";
  const off = busy || away !== null;
  return (
    <article
      ref={ref}
      tabIndex={-1}
      onFocus={onFocus}
      aria-label={item.card.title}
      className={cx(
        "flex gap-3 rounded-lg border border-border p-4 shadow-e1 outline-offset-2",
        phone ? "flex-col" : "items-center",
        selected ? "bg-accent-subtle [&_.text-text-tertiary]:text-text-secondary" : "bg-surface",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Lead item={item} snap={snap} selected={selected} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Source item={item} snap={snap} />
          <div className={cx("text-title-sm font-semibold", selected && "text-accent-text")}>{item.card.title}</div>
          {item.card.details && (
            <Disclosure label={isSessionItem(snap, item) ? "Show the command" : "Details"}>
              <pre className="m-0 max-w-full overflow-x-auto rounded-sm border border-border bg-surface px-2 py-1.5 font-mono text-caption whitespace-pre-wrap text-text">
                {item.card.details}
              </pre>
            </Disclosure>
          )}
          <RiskLine risk={item.card.risk} text={item.card.risk_line} />
        </div>
      </div>
      {confirming ? (
        <div role="group" aria-label="Confirm" className={cx("flex shrink-0 items-center gap-2", phone && "flex-wrap")}>
          <span className={cx("text-body-sm", phone && "basis-full")}>
            <b className="font-semibold">{confirming.label}?</b>{" "}
            <span className="text-text-secondary">{item.card.risk_line}.</span>
          </span>
          <Button size={size} variant="tertiary" className={cx(phone && "flex-1")} disabled={busy} onClick={() => setConfirming(null)}>
            Cancel
          </Button>
          <Button size={size} variant="primary" className={cx(phone && "flex-1")} disabled={off} autoFocus onClick={() => void act(confirming)}>
            {confirming.label}
          </Button>
        </div>
      ) : (
      <div className={cx("flex shrink-0 items-center gap-2", phone && "flex-wrap")}>
        {no && (
          <Button size={size} variant="tertiary" className={cx(phone && "flex-1")} disabled={off} title={away ?? undefined} onClick={() => void act(no)}>
            {no.label}
          </Button>
        )}
        {yes?.decision ? (
          <>
            <Button size={size} className={cx(phone && "flex-1")} onClick={open}>
              Open
            </Button>
            <Button size={size} variant="primary" className={cx(phone && "flex-1")} disabled={off} title={away ?? undefined} onClick={() => void act(yes)}>
              {yes.label}
            </Button>
          </>
        ) : (
          <Button size={size} variant="primary" className={cx(phone && "flex-1")} onClick={open}>
            Open
          </Button>
        )}
        {always && (
          <div className="relative">
            <IconButton
              ref={more}
              label="More choices"
              size={phone ? 44 : 32}
              aria-haspopup="menu"
              aria-expanded={menu}
              disabled={off}
              title={away ?? undefined}
              onClick={() => setMenu((v) => !v)}
            >
              <MoreIcon />
            </IconButton>
            <Menu open={menu} onClose={closeMenu} anchor={more} label="More choices" align="end" className="w-60">
              <MenuItem
                onSelect={() => {
                  setMenu(false);
                  void act(always);
                }}
              >
                {always.label}
              </MenuItem>
            </Menu>
          </div>
        )}
      </div>
      )}
    </article>
  );
}

/** Items from a coding session say "Show the command"; the rest say "Details". */
function isSessionItem(snap: Snapshot, item: NeedsYouItem): boolean {
  return snap.threads.find((t) => t.id === item.thread_id)?.kind === "session";
}

function PastRow({ item, snap, selected, onFocus, ref, expired, phone }: RowProps & { expired: boolean; phone?: boolean }) {
  const agent = agentOf(snap, item);
  const name = agent ? shortName(agent.name) : null;
  const ask = async () => {
    if (!(await send(item.thread_id, askAgainText(item.card.title)))) return;
    showNotice(name ? `Asked ${name} to ask you again.` : "Asked again.");
  };
  // A problem from a chat: its own button (Add a key, Try again…), and the title opens the chat.
  const own = item.card.kind === "problem" ? item.card.actions.find((a) => a.decision === null) : undefined;
  const fix = own && problemKind(own.label) ? own : undefined;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      onFocus={onFocus}
      className={cx(
        "flex min-h-14 items-center gap-3 rounded-lg border border-border px-4 py-2",
        selected ? "bg-accent-subtle [&_.text-text-tertiary]:text-text-secondary" : "bg-surface",
      )}
    >
      <span className={cx("flex min-w-0 flex-1", phone ? "flex-col" : "items-baseline gap-3")}>
        <span className={cx("min-w-0", phone ? "break-words" : "ellipsis flex-1")}>
          {fix ? (
            <Link href={pathFor(snap, item)} tabIndex={-1} className="text-text">
              {item.card.title}
            </Link>
          ) : (
            <TextWithCode text={item.card.title} />
          )}
        </span>
        <span className="shrink-0 text-caption text-text-tertiary">{whenLabel(item.created_at)}</span>
      </span>
      {fix ? (
        <ProblemButton
          threadId={item.thread_id}
          agentId={agent?.id ?? null}
          action={fix.label}
          message={item.card.body}
          size={phone ? "phone" : "md"}
        />
      ) : expired ? (
        <Button size={phone ? "phone" : "md"} onClick={() => void ask()}>
          {name ? `Ask ${name} again` : "Ask again"}
        </Button>
      ) : (
        <Button size={phone ? "phone" : "md"} onClick={() => navigate(pathFor(snap, item))}>Open</Button>
      )}
    </div>
  );
}

function DoneRow({ item, snap, selected, onFocus, ref, last, phone }: RowProps & { last: boolean; phone?: boolean }) {
  // Phones: the title wraps and the time goes on a second line, so no key word is cut off.
  const line = cx(
    "flex items-center gap-3 px-4 text-text",
    phone ? "min-h-14 py-2" : "h-11",
    !last && "shadow-line",
    selected && "bg-accent-subtle [&_.text-text-tertiary]:text-text-secondary",
  );
  const away = useApp(hostAway);
  const stopping = useApp((s) => s.undo?.stopThreadId);
  if (isHeadsUp(item)) {
    const thread = snap.threads.find((t) => t.id === item.thread_id);
    const [lead, ...name] = item.card.title.split(": ");
    return (
      <div ref={ref} tabIndex={-1} onFocus={onFocus} className={line}>
        <CodeIcon className="shrink-0 text-text-secondary" />
        <Lines phone={phone} meta={timeOf(item.created_at)}>
          {name.length ? (
            <>
              {lead}: <Link href={pathFor(snap, item)}>{name.join(": ")}</Link>
            </>
          ) : (
            <Link href={pathFor(snap, item)}>{lead}</Link>
          )}
        </Lines>
        {thread && thread.state !== "idle" && !away && stopping !== thread.id && (
          <Button size="sm" variant="tertiary" onClick={() => stopLater(thread.id, thread.title)}>
            Stop
          </Button>
        )}
      </div>
    );
  }
  const events = useApp((s) => s.feeds[item.thread_id]?.events);
  const done = doneOutcome(item, events);
  return (
    <Link ref={ref} href={pathFor(snap, item)} onFocus={onFocus} className={cx(line, "hover:bg-surface-muted hover:no-underline")}>
      {done.yes ? <CheckIcon className="shrink-0 text-success" /> : <XCircleIcon className="shrink-0 text-text-secondary" />}
      <Lines phone={phone} meta={done.text}>
        {item.card.title}
      </Lines>
    </Link>
  );
}

/**
 * How a finished item ended, in the same words as the card in the chat: "You allowed it",
 * "You said no", "You always allow this for Ava", or that nobody answered: "Stopped",
 * "Closed when Weilo restarted", "No answer in time". `yes` picks the tick.
 *
 * The host doesn't list how or when it closed with the item, so that comes from the chat's
 * own events when they are here (or `decided_at` / `decided_via`, once the host sends them).
 * Without them: no time, rather than the time it was asked.
 */
export function doneOutcome(item: NeedsYouItem, events: Event[] | undefined): { text: string; yes: boolean } {
  const found = decidedAt(events, item.approval_id);
  const extra = item as NeedsYouItem & { decided_at?: string | null; decided_via?: string | null };
  const via = extra.decided_via ?? found?.via ?? null;
  const at = extra.decided_at ?? found?.at ?? null;
  const when = at ? ` · ${timeOf(at)}` : "";
  if (item.state === "expired") return { text: `No answer in time${when}`, yes: false };
  if (via === "stopped") return { text: `Stopped${when}`, yes: false };
  if (via === "interrupted") return { text: `Closed when Weilo restarted${when}`, yes: false };
  const decision = found?.decision ?? (item.state === "allowed" ? { kind: "allow" as const } : { kind: "deny" as const });
  return { text: `${outcomeWords(decision, item.card.kind, item.card.actions)}${when}`, yes: decision.kind !== "deny" };
}

export function doneLine(item: NeedsYouItem, events: Event[] | undefined): string {
  return doneOutcome(item, events).text;
}

/** A row's title and its time: one line on desktop, two on phones. */
function Lines({ phone, meta, children }: { phone?: boolean; meta: string; children: React.ReactNode }) {
  if (phone) {
    return (
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="min-w-0 break-words">{children}</span>
        <span className="text-caption text-text-tertiary">{meta}</span>
      </span>
    );
  }
  return (
    <>
      <span className="ellipsis flex-1">{children}</span>
      <span className="shrink-0 text-caption text-text-tertiary">{meta}</span>
    </>
  );
}
