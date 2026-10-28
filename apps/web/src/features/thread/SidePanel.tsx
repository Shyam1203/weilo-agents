import { useMemo, useState } from "react";
import { mergeSession } from "../../lib/app";
import { engineTitle, projectName, shortName, timeOf } from "../../lib/format";
import { plainStep } from "../../lib/steps";
import { useApp } from "../../lib/store";
import { allSteps } from "../../lib/timeline";
import type { ThreadSummary } from "../../proto/ThreadSummary";
import { EmptyState, ErrorLine } from "../../ui/bits";
import { Button } from "../../ui/Button";
import { cx } from "../../lib/format";
import { CloseIcon } from "../../ui/glyphs";
import { IconButton } from "../../ui/IconButton";
import { Tabs } from "../../ui/Tabs";
import { StepIcon } from "./MessageList";
import { useEvents } from "./useThread";

type AgentTab = "screen" | "files" | "todo";
type SessionTab = "changes" | "terminal" | "files";

/**
 * 400 wide, closed by default. Shows only what is real; empty states otherwise.
 * On narrower windows it floats over the conversation, with its own close button.
 */
export function SidePanel({
  thread,
  agentName,
  floating,
  onClose,
}: {
  thread: ThreadSummary;
  agentName: string;
  floating?: boolean;
  onClose?: () => void;
}) {
  const close = floating && onClose ? onClose : undefined;
  return (
    <aside
      aria-label="Side panel"
      className={cx(
        "flex w-[400px] max-w-full shrink-0 flex-col border-l border-border bg-bg",
        floating && "absolute inset-y-0 right-0 z-20 shadow-e2",
      )}
    >
      {thread.kind === "session" ? (
        <SessionPanel thread={thread} onClose={close} />
      ) : (
        <AgentPanel name={shortName(agentName)} onClose={close} />
      )}
    </aside>
  );
}

function PanelTabs<T extends string>({
  items,
  value,
  onChange,
  onClose,
}: {
  items: Array<{ id: T; label: string }>;
  value: NoInfer<T>;
  onChange(v: NoInfer<T>): void;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-1 px-4 shadow-line">
      <Tabs items={items} value={value} onChange={(v) => onChange(v as T)} label="Panel" panelPrefix="side" className="flex-1" />
      {onClose && (
        <IconButton label="Close side panel" onClick={onClose}>
          <CloseIcon size={14} />
        </IconButton>
      )}
    </div>
  );
}

function AgentPanel({ name, onClose }: { name: string; onClose?: () => void }) {
  const [tab, setTab] = useState<AgentTab>("screen");
  const items: Array<{ id: AgentTab; label: string }> = [
    { id: "screen", label: "Screen" },
    { id: "files", label: "Files" },
    { id: "todo", label: "To-do" },
  ];
  return (
    <>
      <PanelTabs items={items} value={tab} onChange={(v) => setTab(v)} onClose={onClose} />
      <div id="side-panel" role="tabpanel" aria-labelledby={`side-tab-${tab}`} className="p-4">
        {tab === "screen" && <EmptyState title={`${name} isn't using a screen right now.`} line={`You'll see it here while ${name} works.`} />}
        {tab === "files" && <EmptyState title="No files yet." line={`Files ${name} makes show here.`} />}
        {tab === "todo" && <EmptyState title="Nothing to do yet." line="Pins and routines show here." />}
      </div>
    </>
  );
}

function SessionPanel({ thread, onClose }: { thread: ThreadSummary; onClose?: () => void }) {
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
      <PanelTabs items={items} value={tab} onChange={(v) => setTab(v)} onClose={onClose} />
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
                {thread.branch && <span className="ellipsis shrink-0 font-mono">{thread.branch}</span>}
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
                      <StepLine title={s.title} />
                    </li>
                  ))}
                </ol>
              </>
            )}
            {thread.worktree && <BringBack thread={thread} />}
          </>
        )}
        {tab === "terminal" && <EmptyState title="Nothing ran yet." line="Commands the session runs show here." />}
        {tab === "files" && <EmptyState title="No files changed yet." line="Changed files show here." />}
      </div>
    </>
  );
}

/** A step in plain words, with the file or command it touched beneath. */
function StepLine({ title }: { title: string }) {
  const p = plainStep(title);
  return (
    <span className="flex min-w-0 flex-col">
      <span>{p.label}</span>
      {p.detail && <span className="ellipsis font-mono text-caption text-text-tertiary">{p.detail}</span>}
    </span>
  );
}

/**
 * The session works in its own copy of the project. "Bring changes back" copies its changes
 * into the project folder, after a confirm line, and shows what happened.
 */
function BringBack({ thread }: { thread: ThreadSummary }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const project = projectName(thread.folder) ?? "your project";
  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult({ ok: true, text: await mergeSession(thread.id) });
      setConfirming(false);
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "That didn't work. Nothing was changed." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      {confirming ? (
        <div className="flex flex-col gap-2" role="group" aria-label="Confirm">
          <p className="m-0 text-body-sm">
            <b className="font-semibold">Bring changes back?</b>{" "}
            <span className="text-text-secondary">This copies the session's changes into {project}.</span>
          </p>
          <div className="flex gap-2">
            <Button variant="tertiary" onClick={() => setConfirming(false)} disabled={busy}>
              Back
            </Button>
            <Button variant="primary" onClick={() => void run()} disabled={busy} autoFocus>
              {busy ? "Bringing back…" : "Bring back"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setConfirming(true)}>Bring changes back</Button>
          <span className="text-caption text-text-tertiary">Into {project}</span>
        </div>
      )}
      {result &&
        (result.ok ? (
          <p role="status" className="m-0 text-body-sm text-text-secondary">
            {result.text}
          </p>
        ) : (
          <ErrorLine>{result.text}</ErrorLine>
        ))}
    </div>
  );
}
