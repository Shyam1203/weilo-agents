import { useCallback, useMemo, useRef, useState } from "react";
import { setComposerDraft, startChat, stop } from "../../lib/app";
import { shortName, slugText, startedByName, whenInSentence } from "../../lib/format";
import { navigate, paths, threadPath } from "../../lib/router";
import { useApp } from "../../lib/store";
import type { AgentSummary } from "../../proto/AgentSummary";
import type { ChannelSummary } from "../../proto/ChannelSummary";
import type { ThreadSummary } from "../../proto/ThreadSummary";
import { Avatar, SessionMark } from "../../ui/Avatar";
import { EmptyState, StatusPill, TopBar } from "../../ui/bits";
import { PlusIcon } from "../../ui/glyphs";
import { IconButton } from "../../ui/IconButton";
import { Link } from "../../ui/Link";
import { Menu, MenuItem } from "../../ui/Menu";
import { Tabs } from "../../ui/Tabs";
import { PanelToggle, ThreadScreen } from "./ThreadScreen";
import { BackButton } from "../mobile/TabBar";
import { DRAFT_PREFIX, focusComposerSoon, isDraftThread, useThreadState, useVariant } from "./useThread";
import { Button } from "../../ui/Button";

const OVERVIEW = "overview";

/** Members: agents who own a thread here, the main agent (lead) first. */
export function channelMembers(channelId: string, threads: ThreadSummary[], agents: AgentSummary[]): AgentSummary[] {
  const ids = new Set(threads.filter((t) => t.channel_id === channelId && t.agent_id).map((t) => t.agent_id!));
  return agents.filter((a) => ids.has(a.id));
}

export function channelThreads(channelId: string, threads: ThreadSummary[]): ThreadSummary[] {
  return threads.filter((t) => t.channel_id === channelId && t.kind === "chat");
}

/**
 * The tab to show when the link names none: the lead's conversation, as in the mock.
 * The host has no "lead" field yet, so the lead is the first member (the main agent when
 * it has a conversation here) and we open the lead's most recent one. If the lead has none,
 * the most recent conversation; with none at all, Overview.
 */
export function defaultTab(list: ThreadSummary[], leadId?: string | null): string {
  const newestFirst = [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const lead = leadId ? newestFirst.find((t) => t.agent_id === leadId) : undefined;
  return (lead ?? newestFirst[0])?.id ?? OVERVIEW;
}

/** Overview order: what needs you, then what is working, then the most recent. */
export function overviewOrder<T extends Pick<ThreadSummary, "state" | "updated_at">>(items: T[]): T[] {
  const rank = (t: T) => (t.state === "needs_you" ? 0 : t.state === "working" ? 1 : 2);
  return [...items].sort((a, b) => rank(a) - rank(b) || b.updated_at.localeCompare(a.updated_at));
}

/**
 * Sessions an agent started from this channel that are waiting on you: shown under its
 * chat here, so the person sees them where the work was asked for.
 */
export function waitingSessions(channelId: string, agentId: string | null | undefined, threads: ThreadSummary[]): ThreadSummary[] {
  if (!agentId) return [];
  return threads.filter((t) => t.kind === "session" && t.channel_id === channelId && t.started_by === agentId && t.state === "needs_you");
}

/** Opens a new chat with an agent, its message box ready. The chat is made on its first message. */
function openNewChat(channelId: string, agent: AgentSummary) {
  const id = `${DRAFT_PREFIX}${agent.id}`;
  focusComposerSoon(id);
  navigate(paths.channel(channelId, id));
}

export function ChannelView({ channel, threadId }: { channel: ChannelSummary; threadId: string | null }) {
  const snap = useApp((s) => s.snapshot)!;
  const [panel, setPanel] = useState(false);
  const threads = useMemo(() => channelThreads(channel.id, snap.threads), [channel.id, snap.threads]);
  const members = useMemo(() => channelMembers(channel.id, snap.threads, snap.agents), [channel.id, snap.threads, snap.agents]);
  // "new:<agent>": a chat not made yet. Leaving it leaves nothing behind.
  const draftAgent = isDraftThread(threadId) ? snap.agents.find((a) => `${DRAFT_PREFIX}${a.id}` === threadId) : undefined;
  const active =
    threadId && (threadId === OVERVIEW || draftAgent || threads.some((t) => t.id === threadId)) ? threadId : defaultTab(threads, members[0]?.id);
  const thread = threads.find((t) => t.id === active);
  const owner = draftAgent ?? snap.agents.find((a) => a.id === thread?.agent_id) ?? members[0] ?? snap.agents[0];
  const ownerName = owner ? shortName(owner.name) : "Ava";
  const state = useThreadState(thread?.id ?? "");
  const slug = slugText(channel.slug);
  const waiting = useMemo(() => waitingSessions(channel.id, thread?.agent_id, snap.threads), [channel.id, thread?.agent_id, snap.threads]);

  // One header for every tab, so arrow keys keep focus in the tab list.
  const sendFirst = useCallback(
    (text: string) => {
      if (!draftAgent || !threadId) return;
      const draftId = threadId;
      void startChat(channel.id, draftAgent.id, text).then((id) => {
        if (!id) return setComposerDraft(draftId, text);
        focusComposerSoon(id);
        navigate(paths.channel(channel.id, id), { replace: true });
      });
    },
    [channel.id, draftAgent, threadId],
  );

  return (
    <ThreadScreen
      threadId={draftAgent ? threadId : (thread?.id ?? null)}
      after={waiting.length > 0 ? <WaitingSessions sessions={waiting} /> : undefined}
      panelOpen={panel}
      onPanelClose={() => setPanel(false)}
      header={
        <ChannelHeader
          channel={channel}
          threads={threads}
          draft={draftAgent && threadId ? { id: threadId, agent: draftAgent } : null}
          active={active}
          members={members}
          agents={snap.agents}
          panel={thread ? { open: panel, toggle: () => setPanel((v) => !v) } : null}
        />
      }
      list={{
        agentId: draftAgent?.id ?? thread?.agent_id ?? null,
        kind: "chat",
        empty: <EmptyState title="Nothing here yet." line={`Ask ${ownerName} below.`} />,
      }}
      composer={{
        placeholder: `Message #${slug}. ${ownerName} answers.`,
        shortPlaceholder: `Message #${slug}`,
        label: `Message #${slug}`,
        working: state === "working",
        agentName: ownerName,
        onStop: () => thread && void stop(thread.id),
        onSend: draftAgent ? sendFirst : undefined,
      }}
    >
      <ChannelOverview channelId={channel.id} lead={members[0] ?? snap.agents[0]} />
    </ThreadScreen>
  );
}

function ChannelHeader({
  channel,
  threads,
  draft,
  active,
  members,
  agents,
  panel,
}: {
  channel: ChannelSummary;
  threads: ThreadSummary[];
  draft: { id: string; agent: AgentSummary } | null;
  active: string;
  members: AgentSummary[];
  agents: AgentSummary[];
  panel: { open: boolean; toggle(): void } | null;
}) {
  const phone = useVariant() === "phone";
  const [menu, setMenu] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  const tabs = [
    { id: OVERVIEW, label: "Overview" },
    ...threads.map((t) => {
      const a = agents.find((x) => x.id === t.agent_id);
      return { id: t.id, label: t.title, lead: a ? <Avatar name={a.name} color={a.color} size={20} /> : undefined };
    }),
    ...(draft ? [{ id: draft.id, label: "New chat", lead: <Avatar name={draft.agent.name} color={draft.agent.color} size={20} /> }] : []),
  ];
  const newThread = (agent: AgentSummary) => {
    setMenu(false);
    openNewChat(channel.id, agent);
  };
  const slug = slugText(channel.slug);
  const lead = members[0];
  const memberLabel =
    members.length === 0
      ? undefined
      : `Members: ${members.map((m, i) => (i === 0 ? `${shortName(m.name)} (lead)` : shortName(m.name))).join(" and ")}`;

  const tabList = (
    <Tabs
      items={tabs}
      value={active}
      onChange={(id) => navigate(id === OVERVIEW ? paths.overview(channel.id) : paths.channel(channel.id, id))}
      label="Chats"
      scroll
    />
  );

  return (
    <>
    <TopBar className={phone ? "px-4" : "pr-4 pl-6"}>
      {phone && <BackButton />}
      <h1 className="m-0 flex min-w-0 shrink-0 items-center gap-1 text-title-sm font-semibold whitespace-nowrap max-md:flex-1 max-md:shrink">
        <span className="font-medium text-text-tertiary">#</span>
        <span className="ellipsis">{slug}</span>
      </h1>
      <div className={phone ? "flex shrink-0 items-center" : "flex min-w-0 flex-1 items-center gap-1"}>
        {!phone && tabList}
        <div className="relative shrink-0">
          <IconButton
            ref={menuButton}
            label="New chat"
            size={28}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => (agents.length === 1 ? newThread(agents[0]!) : setMenu((v) => !v))}
          >
            <PlusIcon />
          </IconButton>
          <Menu open={menu} onClose={closeMenu} anchor={menuButton} label="New chat" align={phone ? "end" : "start"} className="w-56">
            {agents.map((a) => (
              <MenuItem key={a.id} onSelect={() => newThread(a)}>
                <Avatar name={a.name} color={a.color} size={20} />
                New chat with {shortName(a.name)}
              </MenuItem>
            ))}
          </Menu>
        </div>
      </div>
      {members.length > 0 && !phone && (
        <div role="img" aria-label={memberLabel} title={lead ? `${shortName(lead.name)} leads this channel` : undefined} className="flex shrink-0 items-center">
          {members.map((m, i) => (
            <Avatar key={m.id} name={m.name} color={m.color} size={24} ring className={i > 0 ? "-ml-1" : undefined} />
          ))}
        </div>
      )}
      {panel && !phone && <PanelToggle open={panel.open} onToggle={panel.toggle} />}
    </TopBar>
    {phone && <div className="flex h-11 shrink-0 items-center px-4 shadow-line">{tabList}</div>}
    </>
  );
}

/** "Fix checkout · Session · needs you [Open]", under the chat it came from. */
function WaitingSessions({ sessions }: { sessions: ThreadSummary[] }) {
  return (
    <div className="flex flex-col gap-2">
      {sessions.map((t) => (
        <div key={t.id} className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2 shadow-e1">
          <SessionMark size={32} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="ellipsis font-medium">{t.title}</span>
            <span className="ellipsis text-caption text-warning">Session · needs you</span>
          </span>
          <Link href={paths.session(t.id)} className="shrink-0 rounded-sm px-1 text-body-sm font-medium" aria-label={`Open ${t.title}`}>
            Open
          </Link>
        </div>
      ))}
    </div>
  );
}

/**
 * The second line of an Overview row: what it is doing now, else who it is and when it
 * was last active ("Mia · last active today at 9:30").
 */
export function overviewLine(t: ThreadSummary, agents: AgentSummary[], now = new Date()): string {
  if (t.live_line) return t.live_line;
  const agent = agents.find((a) => a.id === t.agent_id);
  const who = t.kind === "session" ? `Session by ${shortName(startedByName(t.started_by, agents))}` : agent ? shortName(agent.name) : "Chat";
  const when = whenInSentence(t.updated_at, now);
  return when ? `${who} · last active ${when}` : who;
}

/** What is open in a channel: its chats and sessions, what needs you first. */
function ChannelOverview({ channelId, lead }: { channelId: string; lead: AgentSummary | undefined }) {
  const snap = useApp((s) => s.snapshot)!;
  const items = overviewOrder(snap.threads.filter((t) => t.channel_id === channelId && t.kind !== "agent"));
  const leadName = lead ? shortName(lead.name) : null;
  return (
    <div className="mx-auto flex w-full max-w-[768px] flex-col gap-2 p-6 max-md:p-4">
      <h2 className="m-0 flex h-7 items-center text-caption font-medium text-text-tertiary">Chats and sessions</h2>
      {items.length === 0 && (
        <EmptyState
          title="Nothing here yet."
          line={leadName ? `Start a chat with ${leadName}.` : undefined}
          action={
            lead && (
              <Button variant="primary" onClick={() => openNewChat(channelId, lead)}>
                Start a chat
              </Button>
            )
          }
        />
      )}
      {items.map((t) => {
        const agent = snap.agents.find((a) => a.id === t.agent_id);
        return (
          <Link
            key={t.id}
            href={threadPath(t)}
            className="flex min-h-14 items-center gap-3 rounded-lg border border-border px-4 py-2 text-text hover:bg-surface-muted hover:no-underline"
          >
            {t.kind === "session" ? <SessionMark size={32} /> : agent ? <Avatar name={agent.name} color={agent.color} size={32} /> : null}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="ellipsis font-medium">{t.title}</span>
              <span className="ellipsis text-caption text-text-tertiary">{overviewLine(t, snap.agents)}</span>
            </span>
            <StatusPill state={t.state} />
          </Link>
        );
      })}
    </div>
  );
}
