import { useEffect, useMemo, useRef, useState } from "react";
import { mergeSession, sessionChanges } from "../../lib/app";
import { fileChangeWord, filesChangedLine, lineCounts, parseDiff, type DiffFile, type DiffLine } from "../../lib/changes";
import { engineTitle, projectName, shortName } from "../../lib/format";
import { useApp } from "../../lib/store";
import { useEvents } from "./useThread";
import type { ChangedFile } from "../../proto/ChangedFile";
import type { SessionChanges } from "../../proto/SessionChanges";
import type { ThreadSummary } from "../../proto/ThreadSummary";
import { EmptyState, ErrorLine, TextWithCode } from "../../ui/bits";
import { Button } from "../../ui/Button";
import { cx } from "../../lib/format";
import { ChevronDownIcon, CloseIcon } from "../../ui/glyphs";
import { IconButton } from "../../ui/IconButton";
import { Tabs } from "../../ui/Tabs";

type AgentTab = "screen" | "files" | "todo";
type SessionTab = "changes" | "terminal" | "files";

/**
 * 400 wide, closed by default. Shows only what is real; empty states otherwise.
 * On narrower windows it floats over the conversation, with its own close button.
 */
export function SidePanel({
  thread,
  changes,
  agentName,
  floating,
  onClose,
}: {
  thread: ThreadSummary;
  /** A session's changes, asked for by its page. */
  changes?: SessionChanges | null;
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
        <SessionPanel thread={thread} changes={changes ?? null} onClose={close} />
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

function SessionPanel({ thread, changes, onClose }: { thread: ThreadSummary; changes: SessionChanges | null; onClose?: () => void }) {
  const [tab, setTab] = useState<SessionTab>("changes");
  const engines = useApp((s) => s.engines);
  const files = changes?.files ?? [];
  // After "Copy the changes" the session's copy matches the project again, so there's nothing new.
  const copied = useEvents(thread.id).some((e) => e.body.kind === "step" && e.body.step_id.startsWith("bring-back-") && e.body.status !== "failed");
  const project = projectName(thread.folder) ?? "your project";
  const items: Array<{ id: SessionTab; label: string }> = [
    { id: "changes", label: "Changes" },
    { id: "terminal", label: "Terminal" },
    { id: "files", label: "Files" },
  ];
  return (
    <>
      <PanelTabs items={items} value={tab} onChange={(v) => setTab(v)} onClose={onClose} />
      <div id="side-panel" role="tabpanel" aria-labelledby={`side-tab-${tab}`} className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
        {tab === "changes" && (
          <>
            {changes && files.length > 0 ? (
              <ChangedFiles changes={changes} />
            ) : copied ? (
              <EmptyState title={`Changes copied into ${project}.`} line="New changes show here as the session works." />
            ) : (
              <EmptyState title="No changes yet." line="They show here as the session works." />
            )}
            {thread.worktree && files.length > 0 && <CopyBack thread={thread} />}
            <SessionDetails thread={thread} engineName={thread.engine ? engineTitle(thread.engine, engines ?? undefined) : null} />
          </>
        )}
        {tab === "terminal" && <EmptyState title="Nothing ran yet." line="Commands the session runs show here." />}
        {tab === "files" &&
          (files.length > 0 ? (
            <FileList files={files} />
          ) : copied ? (
            <EmptyState title={`Changes copied into ${project}.`} line="New changes show here as the session works." />
          ) : (
            <EmptyState title="No files changed yet." line="Changed files show here." />
          ))}
      </div>
    </>
  );
}

/**
 * What the session changed so far, asked again whenever its chat moves on. Out-of-date
 * answers are dropped; if the host can't say, nothing is shown.
 */
export function useSessionChanges(threadId: string | null, version: number): SessionChanges | null {
  const [changes, setChanges] = useState<{ id: string; data: SessionChanges } | null>(null);
  useEffect(() => {
    if (!threadId) return;
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

/** "2 files +13 −1", then each file's changed lines, like the mock. */
function ChangedFiles({ changes }: { changes: SessionChanges }) {
  const parsed = useMemo(() => parseDiff(changes.diff), [changes.diff]);
  const blocks = useMemo(() => {
    const out: Array<{ file: ChangedFile | null; diff: DiffFile | null }> = changes.files.map((f) => ({
      file: f,
      diff: parsed.find((d) => d.path === f.path) ?? null,
    }));
    for (const d of parsed) if (!changes.files.some((f) => f.path === d.path)) out.push({ file: null, diff: d });
    return out;
  }, [changes.files, parsed]);
  const added = changes.files.reduce((n, f) => n + f.added, 0);
  const removed = changes.files.reduce((n, f) => n + f.removed, 0);
  return (
    <section aria-label="Changed files" className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2 text-caption text-text-secondary">
        <span>{filesChangedLine(changes.files)}</span>
        <Counts added={added} removed={removed} />
      </div>
      {blocks.map(({ file, diff }) => (
        <FileDiff
          key={file?.path ?? diff!.path}
          path={file?.path ?? diff!.path}
          word={file ? fileChangeWord(file.status) : null}
          added={file?.added ?? diff!.added}
          removed={file?.removed ?? diff!.removed}
          diff={diff}
        />
      ))}
      {changes.truncated && <p className="m-0 text-caption text-text-tertiary">Only the first part is shown.</p>}
    </section>
  );
}

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="shrink-0 font-mono text-caption">
      {added > 0 && <span className="text-success">+{added}</span>}
      {added > 0 && removed > 0 && " "}
      {removed > 0 && <span className="text-danger">−{removed}</span>}
    </span>
  );
}

/** Long files show their first lines; the rest is one click away. */
const FIRST_LINES = 40;

/** One file: its name and +N −M, then its changed parts with line numbers. Long lines wrap. */
function FileDiff({
  path,
  word,
  added,
  removed,
  diff,
}: {
  path: string;
  word: string | null;
  added: number;
  removed: number;
  diff: DiffFile | null;
}) {
  const [all, setAll] = useState(false);
  const total = diff?.hunks.reduce((n, h) => n + h.lines.length, 0) ?? 0;
  let budget = all ? Infinity : FIRST_LINES;
  const name = path.split("/").pop() ?? path;
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <div className="flex min-h-9 items-center gap-2 bg-surface-muted px-3 py-1.5" title={path}>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="ellipsis font-mono text-caption text-text">{name}</span>
          {name !== path && <span className="ellipsis text-caption text-text-tertiary">{path.slice(0, path.length - name.length - 1)}</span>}
        </span>
        {word && added + removed === 0 && <span className="shrink-0 text-caption text-text-tertiary">{word}</span>}
        <Counts added={added} removed={removed} />
      </div>
      {diff?.binary && <p className="m-0 border-t border-border px-3 py-2 text-caption text-text-tertiary">This file can't be shown as text.</p>}
      {diff && diff.hunks.length > 0 && (
        <div className="border-t border-border py-1 font-mono text-caption leading-5" aria-label={`Changes in ${name}`} role="group">
          {diff.hunks.map((h, hi) => {
            if (budget <= 0) return null;
            const lines = h.lines.slice(0, budget);
            budget -= lines.length;
            return (
              <div key={hi}>
                {hi > 0 && (
                  <div aria-hidden="true" className="px-3 text-text-tertiary">
                    ⋯
                  </div>
                )}
                {lines.map((l, li) => (
                  <div key={li} className={cx("flex", LINE_TONE[l.kind])}>
                    <span aria-hidden="true" className="w-10 shrink-0 pr-2 text-right text-text-tertiary select-none">
                      {l.no}
                    </span>
                    <span aria-hidden="true" className="w-3 shrink-0 select-none">
                      {l.kind === "add" ? "+" : l.kind === "remove" ? "−" : ""}
                    </span>
                    <span className="sr-only">{l.kind === "add" ? "Added: " : l.kind === "remove" ? "Removed: " : ""}</span>
                    <span className="min-w-0 flex-1 pr-3 whitespace-pre-wrap [overflow-wrap:anywhere]">{l.text || " "}</span>
                  </div>
                ))}
              </div>
            );
          })}
          {!all && total > FIRST_LINES && (
            <button
              type="button"
              onClick={() => setAll(true)}
              className="mx-3 my-1 border-0 bg-transparent p-0 font-sans text-caption font-medium text-accent-text hover:underline"
            >
              Show all {total} lines
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const LINE_TONE: Record<DiffLine["kind"], string> = {
  add: "bg-success-bg text-text",
  remove: "bg-danger-bg text-text",
  context: "text-text-secondary",
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

/**
 * The session works in its own copy of the project. "Copy the changes into shop" copies
 * them into the project folder, after a confirm line, and shows what happened.
 */
function CopyBack({ thread }: { thread: ThreadSummary }) {
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
    <div className="flex flex-col gap-2">
      {confirming ? (
        <div className="flex flex-col gap-2" role="group" aria-label="Confirm">
          <p className="m-0 text-body-sm">
            <b className="font-semibold">Copy the changes into {project}?</b>{" "}
            <span className="text-text-secondary">They go into your {project} folder.</span>
          </p>
          <div className="flex gap-2">
            <Button variant="tertiary" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void run()} disabled={busy} autoFocus>
              {busy ? "Copying…" : "Copy the changes"}
            </Button>
          </div>
        </div>
      ) : (
        <Button className="w-full" onClick={() => setConfirming(true)}>
          Copy the changes into {project}
        </Button>
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

/**
 * Phones: "2 files changed +13 −1 · See changes", which opens the changes full screen,
 * with Copy the changes when the session worked in its own copy.
 */
export function ChangesRow({ thread, changes, onOpen }: { thread: ThreadSummary; changes: SessionChanges; onOpen?(): void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const added = changes.files.reduce((n, f) => n + f.added, 0);
  const removed = changes.files.reduce((n, f) => n + f.removed, 0);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <>
      <button
        type="button"
        onClick={() => (onOpen ? onOpen() : setOpen(true))}
        className={cx(
          "flex w-full shrink-0 items-center gap-2 border-0 bg-surface text-left text-body-sm text-text shadow-line",
          onOpen ? "min-h-10 px-6 hover:bg-surface-muted" : "min-h-12 px-4",
        )}
      >
        <span className="min-w-0 flex-1">
          {filesChangedLine(changes.files)} <Counts added={added} removed={removed} />
        </span>
        <span className="font-medium text-accent-text">See changes</span>
        <ChevronDownIcon size={12} className="-rotate-90 text-text-secondary" />
      </button>
      <dialog
        ref={ref}
        aria-label="Changes"
        onClose={() => setOpen(false)}
        className="m-0 h-dvh max-h-none w-full max-w-none border-0 bg-bg p-0 text-text"
      >
        {open && (
          <div className="flex h-full flex-col">
            <div className="safe-top flex min-h-14 shrink-0 items-center gap-2 px-4 shadow-line">
              <h2 className="m-0 min-w-0 flex-1 text-title-sm font-semibold">Changes</h2>
              <IconButton label="Close" size={44} onClick={() => setOpen(false)} autoFocus>
                <CloseIcon />
              </IconButton>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              <ChangedFiles changes={changes} />
              {thread.worktree && <CopyBack thread={thread} />}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
