import { useEffect, useMemo, useState } from "react";
import { setComposerDraft, stop } from "../../lib/app";
import { channelLabel, dollars, shortName, startedByName } from "../../lib/format";
import { navigate, paths } from "../../lib/router";
import { useApp } from "../../lib/store";
import { totalCost } from "../../lib/timeline";
import type { ThreadSummary } from "../../proto/ThreadSummary";
import { SessionMark } from "../../ui/Avatar";
import { EmptyState, StatusPill, TopBar } from "../../ui/bits";
import { Button } from "../../ui/Button";
import { Link } from "../../ui/Link";
import { PanelToggle, ThreadScreen } from "./ThreadScreen";
import { useEvents, useThreadState } from "./useThread";

/** A coding session: its name, who started it and where, status, Ask Ava and Stop. */
export function SessionView({ thread }: { thread: ThreadSummary }) {
  const [panel, setPanel] = useState(false);
  const state = useThreadState(thread.id);
  const snap = useApp((s) => s.snapshot)!;
  const events = useEvents(thread.id);
  const cost = useMemo(() => totalCost(events), [events]);
  const channel = snap.channels.find((c) => c.id === thread.channel_id);
  const watcher = snap.agents.find((a) => a.id === thread.agent_id) ?? snap.agents[0];
  const by = startedByName(thread.started_by, snap.agents);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        void stop(thread.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [thread.id]);

  const askAva = () => {
    if (!watcher) return;
    setComposerDraft(watcher.main_thread_id, `About the session “${thread.title}”: `);
    navigate(paths.agent(watcher.id));
  };
  const watcherName = watcher ? shortName(watcher.name) : null;

  return (
    <ThreadScreen
      threadId={thread.id}
      panelOpen={panel}
      header={
        <TopBar className="pr-4 pl-6">
          <SessionMark size={24} />
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="ellipsis m-0 text-title-sm font-semibold">{thread.title}</h1>
            <span className="ellipsis text-caption text-text-tertiary">
              Started by {by}
              {channel && (
                <>
                  {" in "}
                  <Link href={paths.channel(channel.id)}>{channelLabel(channel.slug)}</Link>
                </>
              )}
              {thread.folder && ` · ${thread.folder}`}
            </span>
          </div>
          <StatusPill state={state} />
          {watcherName && (
            <Button title={`Ask ${watcherName} about this session`} onClick={askAva}>
              Ask {watcherName}
            </Button>
          )}
          <Button onClick={() => void stop(thread.id)} disabled={state === "idle"} title="⌘.">
            Stop
          </Button>
          <PanelToggle open={panel} onToggle={() => setPanel((v) => !v)} />
        </TopBar>
      }
      list={{
        agentId: thread.agent_id,
        kind: "session",
        empty: <EmptyState title="This session hasn't started yet." line="Tell it what to do below." />,
      }}
      composer={{
        placeholder: thread.agent_id && watcherName ? `Tell this session what to change. ${watcherName} sees it too.` : "Tell this session what to change.",
        label: "Message this session",
        working: state === "working",
        agentName: null,
        onStop: () => void stop(thread.id),
        hint: (
          <span>
            ⌘. stops the session{cost > 0n ? ` · ${dollars(cost)} so far` : ""}
          </span>
        ),
      }}
    />
  );
}
