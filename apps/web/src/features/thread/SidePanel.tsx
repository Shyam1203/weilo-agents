import { useMemo, useState } from "react";
import { engineTitle, shortName, timeOf } from "../../lib/format";
import { useApp } from "../../lib/store";
import { allSteps } from "../../lib/timeline";
import type { ThreadSummary } from "../../proto/ThreadSummary";
import { EmptyState } from "../../ui/bits";
import { Tabs } from "../../ui/Tabs";
import { StepIcon } from "./MessageList";
import { useEvents } from "./useThread";

type AgentTab = "screen" | "files" | "todo";
type SessionTab = "changes" | "terminal" | "files";

/** 400 wide, closed by default. Shows only what is real; empty states otherwise. */
export function SidePanel({ thread, agentName }: { thread: ThreadSummary; agentName: string }) {
  return (
    <aside aria-label="Side panel" className="flex w-[400px] shrink-0 flex-col border-l border-border bg-bg">
      {thread.kind === "session" ? <SessionPanel thread={thread} /> : <AgentPanel name={shortName(agentName)} />}
    </aside>
  );
}

function PanelTabs<T extends string>({ items, value, onChange }: { items: Array<{ id: T; label: string }>; value: T; onChange(v: T): void }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-1 px-4 shadow-line">
      <Tabs items={items} value={value} onChange={(v) => onChange(v as T)} label="Panel" panelPrefix="side" />
    </div>
  );
}

function AgentPanel({ name }: { name: string }) {
  const [tab, setTab] = useState<AgentTab>("screen");
  const items: Array<{ id: AgentTab; label: string }> = [
    { id: "screen", label: "Screen" },
    { id: "files", label: "Files" },
    { id: "todo", label: "To-do" },
  ];
  return (
    <>
      <PanelTabs items={items} value={tab} onChange={setTab} />
      <div id="side-panel" role="tabpanel" aria-labelledby={`side-tab-${tab}`} className="p-4">
        {tab === "screen" && <EmptyState title={`${name} isn't using a screen right now.`} line="You'll see it here while she works." />}
        {tab === "files" && <EmptyState title="No files yet." line={`Files ${name} makes show here.`} />}
        {tab === "todo" && <EmptyState title="Nothing to do yet." line="Pins and routines show here." />}
      </div>
    </>
  );
}

function SessionPanel({ thread }: { thread: ThreadSummary }) {
  const [tab, setTab] = useState<SessionTab>("changes");
  const events = useEvents(thread.id);
  const steps = useMemo(() => allSteps(events), [events]);
  const engines = useApp((s) => s.engines);
  const items: Array<{ id: SessionTab; label: string }> = [
    { id: "changes", label: "Changes" },
    { id: "terminal", label: "Terminal" },
    { id: "files", label: "Files" },
  ];
  return (
    <>
      <PanelTabs items={items} value={tab} onChange={setTab} />
      <div id="side-panel" role="tabpanel" aria-labelledby={`side-tab-${tab}`} className="flex flex-col gap-3 overflow-y-auto p-4">
        {tab === "changes" && (
          <>
            {(thread.engine || thread.folder) && (
              <div className="flex min-w-0 items-center gap-2 text-caption text-text-secondary">
                {thread.engine && (
                  <span className="shrink-0 rounded-sm bg-surface-muted px-1.5 font-medium text-text-secondary">
                    {engineTitle(thread.engine, engines ?? undefined)}
                  </span>
                )}
                {thread.folder && <span className="ellipsis font-mono">{thread.folder}</span>}
              </div>
            )}
            {steps.length === 0 ? (
              <EmptyState title="No changes yet." line="They show here as the session works." />
            ) : (
              <>
                <div className="pt-2 text-caption font-medium text-text-tertiary">What happened</div>
                <ol className="m-0 flex list-none flex-col gap-2 p-0 text-body-sm">
                  {steps.map((s) => (
                    <li key={s.id} className="flex gap-2">
                      <span className="w-10 shrink-0 pt-0.5 text-caption text-text-tertiary">{timeOf(s.at)}</span>
                      <StepIcon status={s.status} />
                      <span className="min-w-0">{s.title}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </>
        )}
        {tab === "terminal" && <EmptyState title="Nothing ran yet." line="Commands the session runs show here." />}
        {tab === "files" && <EmptyState title="No files changed yet." line="Changed files show here." />}
      </div>
    </>
  );
}
