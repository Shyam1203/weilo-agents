import { useEffect, useMemo, useState } from "react";
import { create, loadEngines } from "../../lib/app";
import { cx, engineTitle, projectName, slugPreview } from "../../lib/format";
import { navigate, paths } from "../../lib/router";
import { useApp } from "../../lib/store";
import { Dialog, Field, inputClass } from "../../ui/Dialog";

interface Props {
  open: boolean;
  onClose(): void;
}

function useEngines(open: boolean) {
  const engines = useApp((s) => s.engines);
  useEffect(() => {
    if (open && !engines) loadEngines().catch(() => {});
  }, [open, engines]);
  return engines?.filter((e) => e.installed) ?? null;
}

function useSubmit(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, reset: () => setError(null) };
}

function EngineSelect({ value, onChange, engines }: { value: string; onChange(v: string): void; engines: ReturnType<typeof useEngines> }) {
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} disabled={!engines}>
      {!engines && <option>Loading…</option>}
      {engines?.map((e) => (
        <option key={e.id} value={e.id}>
          {engineTitle(e.id, [e])}
        </option>
      ))}
    </select>
  );
}

function useDefaultEngine(engines: ReturnType<typeof useEngines>, value: string, set: (v: string) => void) {
  useEffect(() => {
    if (!value && engines?.length) set((engines.find((e) => e.default) ?? engines[0]!).id);
  }, [engines, value, set]);
}

export function NewAgentDialog({ open, onClose }: Props) {
  const [name, setName] = useState("");
  const [engine, setEngine] = useState("");
  const engines = useEngines(open);
  useDefaultEngine(engines, engine, setEngine);
  const { busy, error, run } = useSubmit(onClose);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New agent"
      description="A teammate who stays and works for you."
      submitLabel="Make agent"
      busy={busy}
      error={error}
      canSubmit={!!name.trim() && !!engine}
      onSubmit={() =>
        run(async () => {
          const v = await create({ method: "create_agent", params: { name: name.trim(), engine, model: null } }, "agent");
          setName("");
          navigate(paths.agent(v.data.id));
        })
      }
    >
      <Field label="Name">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Researcher" autoFocus />
      </Field>
      <Field label="AI it uses">
        <EngineSelect value={engine} onChange={setEngine} engines={engines} />
      </Field>
    </Dialog>
  );
}

export function NewChannelDialog({ open, onClose }: Props) {
  const [title, setTitle] = useState("");
  const { busy, error, run } = useSubmit(onClose);
  const slug = slugPreview(title);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New channel"
      description="A place for one project. Ava files work here."
      submitLabel="Make channel"
      busy={busy}
      error={error}
      canSubmit={!!slug}
      onSubmit={() =>
        run(async () => {
          const v = await create({ method: "create_channel", params: { title: title.trim() } }, "channel");
          setTitle("");
          navigate(paths.channel(v.data.id));
        })
      }
    >
      <Field label="Name" hint={slug ? `Shows as #${slug}` : "One or two words, like Shop launch."}>
        <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shop launch" autoFocus />
      </Field>
    </Dialog>
  );
}

/** Projects already worked on, newest first: the folders of earlier sessions. */
export function knownProjects(threads: Array<{ kind: string; folder: string | null; updated_at: string }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...threads].sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
    if (t.kind !== "session" || !t.folder || seen.has(t.folder)) continue;
    seen.add(t.folder);
    out.push(t.folder);
  }
  return out;
}

const OTHER = "\u0000other";

/** Choices drawn as a row of chips (a radio group), not a native select. */
function ChoiceChips({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  items: Array<{ id: string; label: string; title?: string }>;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={on}
            title={it.title}
            onClick={() => onChange(it.id)}
            className={cx(
              "h-8 max-w-full rounded-md border px-3 text-body-sm font-medium max-md:h-11",
              on ? "border-accent bg-accent-subtle text-accent-text" : "ghost border-border bg-surface text-text",
            )}
          >
            <span className="ellipsis block">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * New → Session (§5.2): what it should do and which project. The computer and the AI are
 * prefilled; the AI can be changed.
 */
export function NewSessionDialog({ open, onClose }: Props) {
  const threads = useApp((s) => s.snapshot?.threads ?? null);
  const hostName = useApp((s) => s.hostName);
  const projects = useMemo(() => knownProjects(threads ?? []), [threads]);
  const [task, setTask] = useState("");
  const [project, setProject] = useState("");
  const [folder, setFolder] = useState("");
  const [engine, setEngine] = useState("");
  const [changeAi, setChangeAi] = useState(false);
  const engines = useEngines(open);
  useDefaultEngine(engines, engine, setEngine);
  const { busy, error, run } = useSubmit(onClose);
  const chosen = project || projects[0] || OTHER;
  const path = chosen === OTHER ? folder.trim() : chosen;
  const ai = engines?.find((e) => e.id === engine);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New session"
      description="One piece of work in a project on your computer."
      submitLabel="Start session"
      busy={busy}
      error={error}
      canSubmit={!!task.trim() && !!path && !!engine}
      onSubmit={() =>
        run(async () => {
          const v = await create(
            { method: "start_session", params: { folder: path, engine, title: task.trim(), channel_id: null, agent_id: null } },
            "thread",
          );
          setTask("");
          setFolder("");
          navigate(paths.session(v.data.id));
        })
      }
    >
      <Field label="What should it do?">
        <input className={inputClass} value={task} onChange={(e) => setTask(e.target.value)} placeholder="Fix the checkout bug" autoFocus />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-text-secondary">Project</span>
        {projects.length > 0 && (
          <ChoiceChips
            label="Project"
            value={chosen}
            onChange={setProject}
            items={[...projects.map((f) => ({ id: f, label: projectName(f) ?? f, title: f })), { id: OTHER, label: "Another folder" }]}
          />
        )}
        {chosen === OTHER && (
          <input
            className={`${inputClass} font-mono`}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="~/code/shop"
            aria-label="Folder"
            spellCheck={false}
            autoCapitalize="off"
          />
        )}
      </div>
      <div className="flex flex-col gap-1.5 text-caption text-text-secondary">
        <span>
          Runs on {hostName ?? "this computer"}
          {ai ? ` with ${engineTitle(ai.id, [ai])}` : ""}
          {engines && engines.length > 1 && !changeAi && (
            <>
              {" · "}
              <button type="button" onClick={() => setChangeAi(true)} className="border-0 bg-transparent p-0 font-medium text-accent-text hover:underline">
                Change
              </button>
            </>
          )}
        </span>
        {changeAi && engines && (
          <ChoiceChips label="AI it uses" value={engine} onChange={setEngine} items={engines.map((e) => ({ id: e.id, label: engineTitle(e.id, [e]) }))} />
        )}
      </div>
    </Dialog>
  );
}

export function MoveDialog({ open, onClose, threadId, currentChannelId }: Props & { threadId: string; currentChannelId: string }) {
  const channels = useApp((s) => s.snapshot?.channels ?? null);
  const [target, setTarget] = useState("");
  const { busy, error, run } = useSubmit(onClose);
  const options = channels?.filter((c) => !c.archived && c.id !== currentChannelId) ?? [];
  useEffect(() => {
    if (open && !target && options[0]) setTarget(options[0].id);
  }, [open, target, options]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Move this chat"
      description="Ava learns from where you put things."
      submitLabel="Move"
      busy={busy}
      error={error}
      canSubmit={!!target}
      onSubmit={() =>
        run(async () => {
          await create({ method: "move_thread", params: { thread_id: threadId, channel_id: target } }, "none");
          navigate(paths.channel(target, threadId));
        })
      }
    >
      <Field label="Channel">
        <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.slug}
            </option>
          ))}
        </select>
      </Field>
    </Dialog>
  );
}
