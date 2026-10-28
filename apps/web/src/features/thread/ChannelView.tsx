import { useMemo, useState } from "react";
import { create, showError, stop } from "../../lib/app";
import { shortName, slugText } from "../../lib/format";
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
import { MenuItem, Popover } from "../../ui/Popover";
import { Tabs } from "../../ui/Tabs";
import { ConnectionBanner } from "../shell/Toast";
import { PanelToggle, ThreadScreen } from "./ThreadScreen";
import { BackButton } from "../mobile/TabBar";
import { useThreadState, useVariant } from "./useThread";

const OVERVIEW = "overview";

/** Members: agents who own a thread here, the main agent (lead) first. */
export function channelMembers(channelId: string, threads: ThreadSummary[], agents: AgentSummary[]): AgentSummary[] {
  const ids = new Set(threads.filter((t) => t.channel_id === channelId && t.agent_id).map((t) => t.agent_id!));
  return agents.filter((a) => ids.has(a.id));
}

export function channelThreads(channelId: string, threads: ThreadSummary[]): ThreadSummary[] {
  return threads.filter((t) => t.channel_id === channelId && t.kind === "chat");
}

/** The tab to show when the link names none: the newest thread, else Overview. */
export function defaultTab(list: ThreadSummary[]): string {
  const newest = [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  return newest?.id ?? OVERVIEW;
}

export function ChannelView({ channel, threadId }: { channel: ChannelSummary; threadId: string | null }) {
  const snap = useApp((s) => s.snapshot)!;
  const [panel, setPanel] = useState(false);
  const threads = useMemo(() => channelThreads(channel.id, snap.threads), [channel.id, snap.threads]);
  const members = useMemo(() => channelMembers(channel.id, snap.threads, snap.agents), [channel.id, snap.threads, snap.agents]);
  const active = threadId && (threadId === OVERVIEW || threads.some((t) => t.id === threadId)) ? threadId : defaultTab(threads);
  const thread = threads.find((t) => t.id === active);
  const owner = snap.agents.find((a) => a.id === thread?.agent_id) ?? members[0] ?? snap.agents[0];

  const header = (
    <ChannelHeader
      channel={channel}
      threads={threads}
      active={active}
      members={members}
      agents={snap.agents}
      panel={thread ? { open: panel, toggle: () => setPanel((v) => !v) } : null}
    />
  );

  if (!thread) {
    return (
      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
        {header}
        <ConnectionBanner />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ChannelOverview channelId={channel.id} />
        </div>
      </main>
    );
  }

  return (
    <ThreadView
      key={thread.id}
      thread={thread}
      header={header}
      panel={panel}
      slug={slugText(channel.slug)}
      ownerName={owner ? shortName(owner.name) : "Ava"}
    />
  );
}

function ThreadView({
  thread,
  header,
  panel,
  slug,
  ownerName,
}: {
  thread: ThreadSummary;
  header: React.ReactNode;
  panel: boolean;
  slug: string;
  ownerName: string;
}) {
  const state = useThreadState(thread.id);
  return (
    <ThreadScreen
      threadId={thread.id}
      panelOpen={panel}
      header={header}
      list={{
        agentId: thread.agent_id,
        kind: "chat",
        empty: <EmptyState title="Nothing here yet." line={`Ask ${ownerName} below.`} />,
      }}
      composer={{
        placeholder: `Message #${slug}. ${ownerName} answers; type @ to ask someone else.`,
        label: `Message #${slug}`,
        working: state === "working",
        agentName: ownerName,
        onStop: () => void stop(thread.id),
      }}
    />
  );
}

function ChannelHeader({
  channel,
  threads,
  active,
  members,
  agents,
  panel,
}: {
  channel: ChannelSummary;
  threads: ThreadSummary[];
  active: string;
  members: AgentSummary[];
  agents: AgentSummary[];
  panel: { open: boolean; toggle(): void } | null;
}) {
  const phone = useVariant() === "phone";
  const [menu, setMenu] = useState(false);
  const tabs = [
    { id: OVERVIEW, label: "Overview" },
    ...threads.map((t) => {
      const a = agents.find((x) => x.id === t.agent_id);
      return { id: t.id, label: t.title, lead: a ? <Avatar name={a.name} color={a.color} size={20} /> : undefined };
    }),
  ];
  const newThread = async (agent: AgentSummary) => {
    setMenu(false);
    try {
      const v = await create({ method: "create_thread", params: { channel_id: channel.id, agent_id: agent.id, title: null } }, "thread");
      navigate(paths.channel(channel.id, v.data.id));
    } catch (e) {
      showError(e);
    }
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
      label="Threads"
      className={phone ? "no-scrollbar min-w-0 overflow-x-auto" : undefined}
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
            label="New thread"
            size={28}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => (agents.length === 1 ? void newThread(agents[0]!) : setMenu((v) => !v))}
          >
            <PlusIcon />
          </IconButton>
          <Popover open={menu} onClose={() => setMenu(false)} label="New thread" role="menu" className={phone ? "top-9 right-0 w-56" : "top-9 left-0 w-56"}>
            {agents.map((a) => (
              <MenuItem key={a.id} onSelect={() => void newThread(a)}>
                <Avatar name={a.name} color={a.color} size={20} />
                New thread with {shortName(a.name)}
              </MenuItem>
            ))}
          </Popover>
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

/** What is open in a channel: its threads and sessions. */
function ChannelOverview({ channelId }: { channelId: string }) {
  const snap = useApp((s) => s.snapshot)!;
  const items = snap.threads
    .filter((t) => t.channel_id === channelId && t.kind !== "agent")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return (
    <div className="mx-auto flex w-full max-w-[768px] flex-col gap-2 p-6 max-md:p-4">
      <h2 className="m-0 flex h-7 items-center text-caption font-medium text-text-tertiary">Threads and sessions</h2>
      {items.length === 0 && <EmptyState title="Nothing here yet." line="Start a thread with the + above." />}
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
              {t.live_line && <span className="ellipsis text-caption text-text-tertiary">{t.live_line}</span>}
            </span>
            <StatusPill state={t.state} />
          </Link>
        );
      })}
    </div>
  );
}
