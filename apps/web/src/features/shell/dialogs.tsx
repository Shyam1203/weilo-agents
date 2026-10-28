import { useEffect, useId, useMemo, useState } from "react";
import { archiveAgent, changeAgentEngine, create } from "../../lib/app";
import { canPick, preferredEngine, statusLine } from "../../lib/engines";
import { engineTitle, lowerYour, projectName, shortName, slugPreview } from "../../lib/format";
import { navigate, paths, useRoute } from "../../lib/router";
import { useApp } from "../../lib/store";
import type { AgentSummary } from "../../proto/AgentSummary";
import { ChoiceChips } from "../../ui/ChoiceChips";
import { Dialog, Field, inputClass } from "../../ui/Dialog";
import { EnginePicker, useEngineList } from "../engines/EnginePicker";

interface Props {
  open: boolean;
  onClose(): void;
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

/** Preselects an engine once the list arrives: the current one, else the best ready one. */
function useDefaultEngine(open: boolean, value: string, set: (v: string) => void, current?: string | null) {
  const engines = useEngineList(open);
  useEffect(() => {
    if (open && !value && engines?.length) set(preferredEngine(engines, current));
  }, [open, engines, value, set, current]);
  return engines;
}

export function NewAgentDialog({ open, onClose }: Props) {
  const [name, setName] = useState("");
  const [engine, setEngine] = useState("");
  const engines = useDefaultEngine(open, engine, setEngine);
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
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-text-secondary">AI it uses</span>
        <EnginePicker label="AI it uses" engines={engines} value={engine} onChange={setEngine} />
      </div>
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
  const engines = useDefaultEngine(open, engine, setEngine);
  const { busy, error, run } = useSubmit(onClose);
  const chosen = project || projects[0] || OTHER;
  const path = chosen === OTHER ? folder.trim() : chosen;
  const ai = engines?.find((e) => e.id === engine);
  const folderHelp = useId();
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
            {
              method: "start_session",
              // The host names the session from the first line of its task, and sends the task as the first message.
              params: { folder: path, engine, title: null, channel_id: null, agent_id: null, task: task.trim() || undefined },
            },
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
          <>
            <input
              className={inputClass}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="~/Documents/shop"
              aria-label="Folder"
              aria-describedby={folderHelp}
              spellCheck={false}
              autoCapitalize="off"
            />
            <span id={folderHelp} className="text-caption text-text-secondary">
              The folder's path, like ~/Documents/shop
            </span>
          </>
        )}
      </div>
      <div className="flex flex-col gap-1.5 text-caption text-text-secondary">
        <span>
          Runs on {lowerYour(hostName) ?? "this computer"}
          {ai ? ` with ${engineTitle(ai.id, [ai])}` : ""}
          {ai && !ai.ready && !changeAi ? `. ${statusLine(ai)}` : ""}
          {engines && engines.filter(canPick).length > 1 && !changeAi && (
            <>
              {" · "}
              <button type="button" onClick={() => setChangeAi(true)} className="border-0 bg-transparent p-0 font-medium text-accent-text hover:underline">
                Change
              </button>
            </>
          )}
        </span>
        {changeAi && <EnginePicker label="AI it uses" engines={engines} value={engine} onChange={setEngine} />}
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

/** "Change AI": moves an agent to another engine. Its next reply starts a new conversation. */
export function ChangeAiDialog({ open, onClose, agent }: Props & { agent: AgentSummary }) {
  const [engine, setEngine] = useState("");
  const engines = useDefaultEngine(open, engine, setEngine, agent.engine);
  const { busy, error, run } = useSubmit(() => {
    setEngine("");
    onClose();
  });
  const name = shortName(agent.name);
  return (
    <Dialog
      open={open}
      onClose={() => {
        setEngine("");
        onClose();
      }}
      title={`Change ${name}'s AI`}
      description={`${name} will start fresh and won't remember this chat.`}
      submitLabel="Change AI"
      busy={busy}
      error={error}
      canSubmit={!!engine && engine !== agent.engine}
      onSubmit={() => run(() => changeAgentEngine(agent.id, engine))}
    >
      <EnginePicker label="AI it uses" engines={engines} value={engine} onChange={setEngine} autoFocus={open} />
    </Dialog>
  );
}

/** "Remove agent": a confirm step, red only on its button. The agent's chats are kept. */
export function RemoveAgentDialog({ open, onClose, agent }: Props & { agent: AgentSummary }) {
  const route = useRoute();
  const { busy, error, run } = useSubmit(onClose);
  const name = shortName(agent.name);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Remove ${name}?`}
      description={`${name} stops and leaves your sidebar. Its chats are kept.`}
      submitLabel={`Remove ${name}`}
      submitVariant="danger-solid"
      busy={busy}
      error={error}
      onSubmit={() =>
        run(async () => {
          await archiveAgent(agent.id);
          if (route.name === "agent" && route.agentId === agent.id) navigate(paths.home(), { replace: true });
        })
      }
    />
  );
}
