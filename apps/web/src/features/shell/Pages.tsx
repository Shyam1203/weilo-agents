import { cx, engineTitle, listWords, shortName, whenInSentence } from "../../lib/format";
import type { Snapshot } from "../../proto/Snapshot";
import { paths, type Route } from "../../lib/router";
import { agentStatus, findThread, mainAgent, problemLines, STATUS_TONE_CLASS, useApp, type StatusTone } from "../../lib/store";
import { useEngineList } from "../engines/EnginePicker";
import { AgentMenuButton } from "./AgentMenu";
import { Avatar } from "../../ui/Avatar";
import { Dot, EmptyState } from "../../ui/bits";
import { Button } from "../../ui/Button";
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
      return main ? <AgentChat key={main.id} agent={main} home /> : <NoAgents />;
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
      return <Calm title="Routines" heading="Coming in the next version." line={`Then ${main ? shortName(main.name) : "Ava"} can do things on a schedule.`} />;
    case "connections":
      return <Calm title="Connections" heading="Coming in the next version." line="Then you can connect email, calendar and more." />;
    case "channels":
      return <ChannelList phone={phone} />;
    case "agents":
      return <AgentList phone={phone} />;
    default:
      return <Missing title="This page doesn't exist." />;
  }
}

/** With no agent at all: say so, with a real button (the sidebar's "+" shows only on hover). */
function NoAgents() {
  const [adding, setAdding] = useState(false);
  return (
    <PageFrame title="Weilo">
      <EmptyState
        title="No agents yet."
        line="Make one to get started."
        action={
          <Button size="md" variant="primary" onClick={() => setAdding(true)}>
            New agent
          </Button>
        }
      />
      <NewAgentDialog open={adding} onClose={() => setAdding(false)} />
    </PageFrame>
  );
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

/**
 * A channel's one line on the Channels page: what needs you, who is working, else when it
 * was last active.
 */
export function channelLine(channelId: string, snap: Pick<Snapshot, "threads" | "agents">, now = new Date()): { text: string; tone: StatusTone } {
  const threads = snap.threads.filter((t) => t.channel_id === channelId);
  const waiting = threads.filter((t) => t.state === "needs_you").length;
  if (waiting > 0) return { text: waiting === 1 ? "Needs you" : `${waiting} need you`, tone: "warn" };
  const working = threads.filter((t) => t.state === "working");
  if (working.length > 0) {
    const names = [
      ...new Set(
        working.map((t) => {
          const a = snap.agents.find((x) => x.id === t.agent_id) ?? snap.agents.find((x) => x.id === t.started_by || x.name === t.started_by);
          return a ? shortName(a.name) : null;
        }),
      ),
    ].filter((n): n is string => !!n);
    return { text: names.length ? `${listWords(names)} ${names.length === 1 ? "is" : "are"} working` : "Working", tone: "ok" };
  }
  const last = threads.map((t) => t.updated_at).sort().pop();
  return last ? { text: `Last active ${whenInSentence(last, now)}`, tone: "quiet" } : { text: "Nothing here yet", tone: "quiet" };
}

function ChannelList({ phone }: { phone?: boolean }) {
  const channels = useApp((s) => s.snapshot!.channels);
  const snap = useApp((s) => s.snapshot!);
  const [adding, setAdding] = useState(false);
  const open = channels.filter((c) => !c.archived);
  return (
    <PageFrame title="Channels" phone={phone} actions={<AddButton label="New channel" phone={phone} onClick={() => setAdding(true)} />}>
      <NewChannelDialog open={adding} onClose={() => setAdding(false)} />
      {open.length === 0 ? (
        <EmptyState title="No channels yet." line="Ava files work here as it comes in." />
      ) : (
        <nav aria-label="Channels" className="flex flex-col gap-0.5">
          {open.map((c) => {
            const line = channelLine(c.id, snap);
            return (
              <Link key={c.id} href={paths.channel(c.id)} className={cx(listRow, "min-h-14 py-1.5")}>
                <span aria-hidden="true" className="w-6 self-start pt-0.5 text-center font-medium text-text-tertiary">
                  #
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="ellipsis font-medium">
                    <span className="sr-only">#</span>
                    {c.slug}
                  </span>
                  <span className={cx("ellipsis text-caption", STATUS_TONE_CLASS[line.tone])}>{line.text}</span>
                </span>
                {c.unread && <Dot label="New" />}
              </Link>
            );
          })}
        </nav>
      )}
    </PageFrame>
  );
}

function AgentList({ phone }: { phone?: boolean }) {
  const agents = useApp((s) => s.snapshot!.agents);
  const problems = useApp(problemLines);
  const engines = useEngineList();
  const [adding, setAdding] = useState(false);
  return (
    <PageFrame title="Agents" phone={phone} actions={<AddButton label="New agent" phone={phone} onClick={() => setAdding(true)} />}>
      <NewAgentDialog open={adding} onClose={() => setAdding(false)} />
      <nav aria-label="Agents" className="flex flex-col gap-0.5">
        {agents.map((a) => {
          const status = agentStatus(a, problems);
          return (
            <div key={a.id} className="flex items-center gap-1">
              <Link href={paths.agent(a.id)} className={cx(listRow, "min-h-14 min-w-0 flex-1 py-1.5")}>
                <Avatar name={a.name} color={a.color} size={32} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="ellipsis font-medium">{a.name}</span>
                  {status.line && <span className={cx("ellipsis text-caption", STATUS_TONE_CLASS[status.tone])}>{status.line}</span>}
                  {!phone && <span className="ellipsis text-caption text-text-tertiary">Uses {engineTitle(a.engine, engines ?? undefined)}</span>}
                </span>
              </Link>
              {!phone && <AgentMenuButton agent={a} />}
            </div>
          );
        })}
      </nav>
    </PageFrame>
  );
}
