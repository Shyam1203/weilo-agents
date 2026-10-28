import { useEffect, useMemo, useState } from "react";
import { mergeSession, sessionChanges } from "../../lib/app";
import { diffTone, fileChangeWord, filesChangedLine, lineCounts, type DiffTone } from "../../lib/changes";
import { engineTitle, projectName, shortName, timeOf } from "../../lib/format";
import { plainStep } from "../../lib/steps";
import { useApp } from "../../lib/store";
import { allSteps } from "../../lib/timeline";
import type { SessionChanges } from "../../proto/SessionChanges";
import type { ThreadSummary } from "../../proto/ThreadSummary";
import { EmptyState, ErrorLine, TextWithCode } from "../../ui/bits";
import { Button } from "../../ui/Button";
import { cx } from "../../lib/format";
import { ChevronDownIcon, CloseIcon } from "../../ui/glyphs";
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
  const changes = useSessionChanges(thread.id, events.length);
  const files = changes?.files ?? [];
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
            {steps.length === 0 && files.length === 0 ? (
              <EmptyState title="No changes yet." line="They show here as the session works." />
            ) : steps.length === 0 ? null : (
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
            {changes && files.length > 0 && <ChangedFiles changes={changes} />}
            {thread.worktree && <BringBack thread={thread} />}
            <SessionDetails thread={thread} engineName={thread.engine ? engineTitle(thread.engine, engines ?? undefined) : null} />
          </>
        )}
        {tab === "terminal" && <EmptyState title="Nothing ran yet." line="Commands the session runs show here." />}
        {tab === "files" &&
          (files.length > 0 ? <FileList files={files} /> : <EmptyState title="No files changed yet." line="Changed files show here." />)}
      </div>
    </>
  );
}

/**
 * What the session changed so far, asked again whenever its chat moves on. Out-of-date
 * answers are dropped; if the host can't say, nothing is shown.
 */
function useSessionChanges(threadId: string, version: number): SessionChanges | null {
  const [changes, setChanges] = useState<{ id: string; data: SessionChanges } | null>(null);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      sessionChanges(threadId)
        .then((data) => live && setChanges({ id: threadId, data }))
        .catch(() => live && setChanges(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [threadId, version]);
  return changes?.id === threadId ? changes.data : null;
}

/** The changed files, then the changes themselves behind "Show the changes". */
function ChangedFiles({ changes }: { changes: SessionChanges }) {
  return (
    <section aria-label="Changed files" className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="text-caption font-medium text-text-tertiary">{filesChangedLine(changes.files)}</div>
      <FileList files={changes.files} />
      {changes.diff && (
        <details className="group text-caption">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm font-medium text-text-secondary hover:text-text [&::-webkit-details-marker]:hidden">
            <ChevronDownIcon size={12} className="shrink-0 -rotate-90 transition-transform duration-[120ms] group-open:rotate-0" />
            Show the changes
          </summary>
          <pre
            tabIndex={0}
            aria-label="The changes"
            className="m-0 mt-2 max-h-[360px] overflow-auto rounded-md border border-border bg-surface py-2 font-mono text-caption leading-5"
          >
            {changes.diff.split("\n").map((line, i) => (
              <span key={i} className={cx("block px-3 whitespace-pre", DIFF_TONE[diffTone(line)])}>
                {line || " "}
              </span>
            ))}
          </pre>
          {changes.truncated && <p className="m-0 mt-1 text-text-tertiary">Only the first part is shown.</p>}
        </details>
      )}
    </section>
  );
}

const DIFF_TONE: Record<DiffTone, string> = {
  add: "bg-success-bg text-text",
  remove: "bg-danger-bg text-text",
  file: "text-text-tertiary",
  hunk: "text-accent-text",
  plain: "text-text-secondary",
};

function FileList({ files }: { files: SessionChanges["files"] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-body-sm">
      {files.map((f) => (
        <li key={f.path} className="flex min-w-0 items-baseline gap-2">
          <span className="ellipsis min-w-0 flex-1 font-mono text-caption" title={f.path}>
            {f.path}
          </span>
          <span className="shrink-0 text-caption text-text-tertiary">
            {fileChangeWord(f.status)}
            {lineCounts(f) && <span className="ml-1.5 font-mono">{lineCounts(f)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Which AI, folder and branch: one click away, never on the surface (§11.0 rule 3). */
function SessionDetails({ thread, engineName }: { thread: ThreadSummary; engineName: string | null }) {
  const rows: Array<[string, string, boolean]> = [];
  if (engineName) rows.push(["AI", engineName, false]);
  if (thread.folder) rows.push(["Folder", thread.folder, true]);
  if (thread.branch) rows.push(["Branch", thread.branch, true]);
  if (rows.length === 0) return null;
  return (
    <details className="group text-caption text-text-tertiary">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm font-medium hover:text-text-secondary [&::-webkit-details-marker]:hidden">
        <ChevronDownIcon size={12} className="shrink-0 -rotate-90 transition-transform duration-[120ms] group-open:rotate-0" />
        Details
      </summary>
      <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map(([k, v, mono]) => (
          <div key={k} className="contents">
            <dt className="text-text-tertiary">{k}</dt>
            <dd className={cx("ellipsis m-0 text-text-secondary", mono && "font-mono")} title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </details>
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
            <TextWithCode text={result.text} />
          </p>
        ) : (
          <ErrorLine>
            <TextWithCode text={result.text} />
          </ErrorLine>
        ))}
    </div>
  );
}
