import { useEffect, useState } from "react";
import { create, loadEngines } from "../../lib/app";
import { engineTitle, slugPreview } from "../../lib/format";
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

export function NewSessionDialog({ open, onClose }: Props) {
  const [folder, setFolder] = useState("");
  const [engine, setEngine] = useState("");
  const engines = useEngines(open);
  useDefaultEngine(engines, engine, setEngine);
  const { busy, error, run } = useSubmit(onClose);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New session"
      description="One piece of work in a folder on this computer."
      submitLabel="Start session"
      busy={busy}
      error={error}
      canSubmit={!!folder.trim() && !!engine}
      onSubmit={() =>
        run(async () => {
          const v = await create(
            { method: "start_session", params: { folder: folder.trim(), engine, title: null, channel_id: null, agent_id: null } },
            "thread",
          );
          setFolder("");
          navigate(paths.session(v.data.id));
        })
      }
    >
      <Field label="Folder">
        <input
          className={`${inputClass} font-mono`}
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="~/code/shop"
          spellCheck={false}
          autoCapitalize="off"
          autoFocus
        />
      </Field>
      <Field label="AI it uses">
        <EngineSelect value={engine} onChange={setEngine} engines={engines} />
      </Field>
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
      title="Move this thread"
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
