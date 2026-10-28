import { useEffect, useMemo, useState } from "react";
import { setComposerDraft, stop } from "../../lib/app";
import { channelLabel, dollars, projectName, shortName, startedByName } from "../../lib/format";
import { navigate, paths } from "../../lib/router";
import { useApp } from "../../lib/store";
import { totalCost } from "../../lib/timeline";
import type { ThreadSummary } from "../../proto/ThreadSummary";
import { SessionMark } from "../../ui/Avatar";
import { EmptyState, StatusPill, TopBar } from "../../ui/bits";
import { Button } from "../../ui/Button";
import { Link } from "../../ui/Link";
import { PanelToggle, ThreadScreen } from "./ThreadScreen";
import { BackButton } from "../mobile/TabBar";
import { useEvents, useThreadState, useVariant } from "./useThread";
import { shortcut, useTouchOnly } from "../../lib/platform";

/** A coding session: its name, who started it and where, status, Ask Ava and Stop. */
export function SessionView({ thread }: { thread: ThreadSummary }) {
  const [panel, setPanel] = useState(false);
  const phone = useVariant() === "phone";
  const state = useThreadState(thread.id);
  const snap = useApp((s) => s.snapshot)!;
  const events = useEvents(thread.id);
  const cost = useMemo(() => totalCost(events), [events]);
  const channel = snap.channels.find((c) => c.id === thread.channel_id);
  const watcher = snap.agents.find((a) => a.id === thread.agent_id) ?? snap.agents[0];
  const by = startedByName(thread.started_by, snap.agents);
  const hostName = useApp((s) => s.hostName);
  const touch = useTouchOnly();
  // Where it runs, in plain words: the computer's name, else the project (the folder's last part).
  const where = hostName ?? projectName(thread.folder);

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
      onPanelClose={() => setPanel(false)}
      header={
        <TopBar className={phone ? "px-4" : "pr-4 pl-6"}>
          {phone ? <BackButton /> : <SessionMark size={24} />}
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
              {where && ` · ${where}`}
            </span>
          </div>
          <StatusPill state={state} />
          {watcherName && !phone && (
            <Button title={`Ask ${watcherName} about this session`} onClick={askAva}>
              Ask {watcherName}
            </Button>
          )}
          <Button onClick={() => void stop(thread.id)} disabled={state === "idle"} title={touch ? undefined : shortcut(".")}>
            Stop
          </Button>
          {!phone && <PanelToggle open={panel} onToggle={() => setPanel((v) => !v)} />}
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
        hint: sessionHint(touch ? null : shortcut("."), cost > 0n ? `${dollars(cost)} so far` : null),
      }}
    />
  );
}

/** "⌘. stops the session · about $0.38 so far"; no key hint on touch screens. */
function sessionHint(stopKey: string | null, cost: string | null) {
  const parts = [stopKey && `${stopKey} stops the session`, cost].filter(Boolean);
  return parts.length ? <span>{parts.join(" · ")}</span> : undefined;
}

