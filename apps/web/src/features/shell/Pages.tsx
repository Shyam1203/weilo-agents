import { cx, shortName } from "../../lib/format";
import { paths, type Route } from "../../lib/router";
import { findThread, mainAgent, useApp } from "../../lib/store";
import { Avatar } from "../../ui/Avatar";
import { Dot, EmptyState } from "../../ui/bits";
import { Link } from "../../ui/Link";
import { IconButton } from "../../ui/IconButton";
import { PlusIcon } from "../../ui/glyphs";
import { NewAgentDialog, NewChannelDialog } from "./dialogs";
import { useState } from "react";
import { NeedsYouPage } from "../needs-you/NeedsYouPage";
import { SettingsPage } from "../settings/SettingsPage";
import { AgentChat } from "../thread/AgentChat";
import { ChannelView } from "../thread/ChannelView";
import { SessionView } from "../thread/SessionView";
import { PageFrame } from "./PageFrame";

/** The page for a route, shared by desktop and phone. */
export function RoutePage({ route, phone }: { route: Route; phone?: boolean }) {
  const snap = useApp((s) => s.snapshot)!;
  const main = useApp(mainAgent);
  switch (route.name) {
    case "home":
      return main ? <AgentChat key={main.id} agent={main} home /> : <Missing title="No agents yet." line="Make one with the + next to Agents." />;
    case "agent": {
      const agent = snap.agents.find((a) => a.id === route.agentId);
      return agent ? <AgentChat key={agent.id} agent={agent} /> : <Missing title="This agent isn't here anymore." />;
    }
    case "channel": {
      const channel = snap.channels.find((c) => c.id === route.channelId);
      return channel ? <ChannelView key={channel.id} channel={channel} threadId={route.threadId} /> : <Missing title="This channel isn't here anymore." />;
    }
    case "session":
      return <SessionPage threadId={route.threadId} />;
    case "needs":
      return <NeedsYouPage phone={phone} />;
    case "settings":
      return <SettingsPage phone={phone} />;
    case "routines":
      return <Calm title="Routines" heading="Coming soon." line={`Soon ${main ? shortName(main.name) : "Ava"} can do things on a schedule.`} />;
    case "connections":
      return <Calm title="Connections" heading="Coming soon." line="Soon you can connect email, calendar and more." />;
    case "channels":
      return <ChannelList phone={phone} />;
    case "agents":
      return <AgentList phone={phone} />;
    default:
      return <Missing title="This page doesn't exist." />;
  }
}

function SessionPage({ threadId }: { threadId: string }) {
  const thread = useApp((s) => findThread(s, threadId));
  return thread ? <SessionView key={thread.id} thread={thread} /> : <Missing title="This session isn't here anymore." />;
}

function Calm({ title, heading, line }: { title: string; heading: string; line: string }) {
  return (
    <PageFrame title={title}>
      <EmptyState title={heading} line={line} />
    </PageFrame>
  );
}

function Missing({ title, line }: { title: string; line?: string }) {
  return (
    <PageFrame title="Weilo">
      <EmptyState title={title} line={line} action={<Link href={paths.home()} className="text-body-sm font-medium">Go home</Link>} />
    </PageFrame>
  );
}

const listRow = "flex min-h-11 items-center gap-3 rounded-md px-2 text-text hover:bg-surface-muted hover:no-underline";

/** The "+" in a list page's title bar: the same as the "+" on a sidebar section. */
function AddButton({ label, phone, onClick }: { label: string; phone?: boolean; onClick(): void }) {
  return (
    <IconButton label={label} size={phone ? 44 : 32} className={phone ? "-mr-3" : undefined} onClick={onClick}>
      <PlusIcon size={phone ? 24 : 16} />
    </IconButton>
  );
}

function ChannelList({ phone }: { phone?: boolean }) {
  const channels = useApp((s) => s.snapshot!.channels);
  const [adding, setAdding] = useState(false);
  const open = channels.filter((c) => !c.archived);
  return (
    <PageFrame title="Channels" phone={phone} actions={<AddButton label="New channel" phone={phone} onClick={() => setAdding(true)} />}>
      <NewChannelDialog open={adding} onClose={() => setAdding(false)} />
      {open.length === 0 ? (
        <EmptyState title="No channels yet." line="Ava files work here as it comes in." />
      ) : (
        <nav aria-label="Channels" className="flex flex-col gap-0.5">
          {open.map((c) => (
            <Link key={c.id} href={paths.channel(c.id)} className={listRow}>
              <span aria-hidden="true" className="w-6 text-center font-medium text-text-tertiary">
                #
              </span>
              <span className="ellipsis flex-1 font-medium">
                <span className="sr-only">#</span>
                {c.slug}
              </span>
              {c.unread && <Dot label="New" />}
            </Link>
          ))}
        </nav>
      )}
    </PageFrame>
  );
}

function AgentList({ phone }: { phone?: boolean }) {
  const agents = useApp((s) => s.snapshot!.agents);
  const [adding, setAdding] = useState(false);
  return (
    <PageFrame title="Agents" phone={phone} actions={<AddButton label="New agent" phone={phone} onClick={() => setAdding(true)} />}>
      <NewAgentDialog open={adding} onClose={() => setAdding(false)} />
      <nav aria-label="Agents" className="flex flex-col gap-0.5">
        {agents.map((a) => (
          <Link key={a.id} href={paths.agent(a.id)} className={cx(listRow, "min-h-14")}>
            <Avatar name={a.name} color={a.color} size={32} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="ellipsis font-medium">{a.name}</span>
              {a.live_line && (
                <span className={cx("ellipsis text-caption", a.state === "working" ? "text-success" : a.state === "needs_you" ? "text-warning" : "text-text-tertiary")}>
                  {a.live_line}
                </span>
              )}
            </span>
          </Link>
        ))}
      </nav>
    </PageFrame>
  );
}
