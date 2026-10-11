import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createAgent, deleteAgent, updateAgent, type Agent, type AgentInput } from "../../api/agents";
import { choosableOf, providerOf, type Model, type Provider } from "../../api/providers";
import type { Extension } from "../../api/extensions";
import type { Plugin } from "../../api/plugins";
import type { Skill } from "../../api/skills";
import { Button } from "../../components/ui/Button";
import { ErrorText, Field } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Card, Row } from "../../components/ui/Row";
import { Select } from "../../components/ui/Select";
import { Switch } from "../../components/ui/Switch";
import type { SettingsPage } from "../settings/SettingsModal";
import { Toggles } from "../../components/ui/Toggles";
import { useAction } from "../../lib/useAction";
import { AvatarPicker } from "./AvatarPicker";
import { DeleteDialog } from "./DeleteDialog";
import { avatarOf, randomAvatar } from "./avatars";

const THINKING = [
  { value: "", label: "Default" },
  { value: "off", label: "Off" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
  { value: "max", label: "Maximum" },
];

// The last choice of the Provider list: not a provider, it opens Settings to add one.
const ADD = "+add";

/** The agent being created or edited, as the form fills it in. */
type Draft = AgentInput & { avatar: NonNullable<AgentInput["avatar"]> };

interface Props {
  agent?: Agent;
  providers: Provider[];
  skills: Skill[];
  plugins: Plugin[];
  extensions: Extension[];
  /** The models the saved keys can use; undefined while they load. */
  models?: Model[];
  onAddProvider: () => void;
  /** Opens the settings popup at a page: where add-ons are added. */
  onOpenSettings: (page: SettingsPage) => void;
  onClose: () => void;
  onSaved: (agent: Agent) => Promise<void>;
  /** Runs after the agent is deleted. */
  onDeleted: () => void;
}

/** Creates an agent, or edits `agent`. */
export function AgentForm({ agent, providers, skills, plugins, extensions, models, onAddProvider, onOpenSettings, onClose, onSaved, onDeleted }: Props) {
  const [draft, setDraft] = useState<Draft>(() =>
    agent ? { name: agent.name, model: agent.model, thinking: agent.thinking, skills: agent.skills, plugins: agent.plugins, extensions: agent.extensions, disabled: agent.disabled, instructions: agent.instructions, avatar: avatarOf(agent) } : { name: "", model: "", thinking: "", skills: [], plugins: [], extensions: [], disabled: [], instructions: "", avatar: randomAvatar() },
  );
  // Which add-on list is open under its row.
  const [choosing, setChoosing] = useState<"skills" | "plugins" | "extensions" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { busy, error, run } = useAction();
  const change = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  // The extensions that come with the app are on unless you turn them off; the others are on only if you turn them on.
  const builtIn = extensions.filter((x) => x.builtin);
  const added = extensions.filter((x) => !x.builtin);
  // A model is "provider/id".
  const firstConnected = providers.find((p) => p.connected)?.id ?? "";
  const [providerId, setProviderId] = useState(() => providerOf(agent?.model ?? "") || firstConnected);
  const ofProvider = choosableOf(models ?? [], providerId);
  const providerOptions = [...providers.filter((p) => p.connected || p.id === providerId).map((p) => ({ value: p.id, label: p.name })), { value: ADD, label: "+ Add provider" }];
  const modelOptions = [...(draft.model && !ofProvider.some((m) => m.id === draft.model) ? [{ value: draft.model, label: draft.model }] : []), ...ofProvider.map((m) => ({ value: m.id, label: m.name }))];
  const pickProvider = (id: string) => {
    if (id === ADD) return onAddProvider();
    setProviderId(id);
    change({ model: choosableOf(models ?? [], id)[0]?.id ?? "" });
  };

  // What is still empty fills in once it can: the first provider (one added while this is open) and its first model (once they load).
  useEffect(() => {
    const id = providerId || firstConnected;
    if (id !== providerId) setProviderId(id);
    const first = choosableOf(models ?? [], id)[0]?.id;
    if (id && !draft.model && first) change({ model: first });
  }, [providerId, firstConnected, models, draft.model]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run("save", async () => onSaved(agent ? await updateAgent(agent.id, draft) : await createAgent(draft)));
  };

  return (
    <Modal title={agent ? "Edit agent" : "New agent"} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <AvatarPicker value={draft.avatar} onChange={(avatar) => change({ avatar })} />
        <Field label="Name">
          <input autoFocus value={draft.name} onChange={(e) => change({ name: e.target.value })} placeholder="Research assistant" className="input" />
        </Field>
        <Field label="Instructions">
          <textarea
            value={draft.instructions}
            onChange={(e) => change({ instructions: e.target.value })}
            rows={5}
            placeholder="You are my research assistant. Find primary sources. Summarize them in plain language. Always cite links."
            className="input resize-y leading-relaxed"
          />
        </Field>
        <Section title="Model">
          <Row title="Provider">
            <Pick>
              <Select label="Provider" value={providerId} disabled={!models} onChange={pickProvider} options={providerOptions} placeholder="Add a provider" />
            </Pick>
          </Row>
          <Row title="Model">
            <Pick>
              <Select label="Model" value={draft.model} disabled={!providerId || !models} onChange={(model) => change({ model })} options={modelOptions} placeholder="Choose a model" />
            </Pick>
          </Row>
          <Row title="Thinking" description="How much the model thinks before it answers. Models that cannot think ignore this.">
            <Pick>
              <Select label="Thinking" value={draft.thinking} onChange={(thinking) => change({ thinking })} options={THINKING} />
            </Pick>
          </Row>
        </Section>
        <Section title="Built-in extensions">
          {builtIn.map((x) => (
            <Row key={x.id} title={x.name} description={x.description}>
              <Switch label={x.name} checked={!draft.disabled.includes(x.id)} onChange={(on) => change({ disabled: on ? draft.disabled.filter((id) => id !== x.id) : [...draft.disabled, x.id] })} />
            </Row>
          ))}
        </Section>
        <Section title="Add-ons">
          <AddOn
            title="Skills"
            on={skills.filter((x) => draft.skills.includes(x.id)).map((x) => x.name)}
            none={skills.length === 0}
            open={choosing === "skills"}
            onToggle={() => (skills.length ? setChoosing(choosing === "skills" ? null : "skills") : onOpenSettings("skills"))}
          >
            <Toggles label="skills" items={skills} empty="" value={draft.skills} onChange={(skills) => change({ skills })} />
          </AddOn>
          <AddOn
            title="Plugins"
            on={draft.plugins.filter((name) => plugins.some((p) => p.name === name))}
            none={plugins.length === 0}
            open={choosing === "plugins"}
            onToggle={() => (plugins.length ? setChoosing(choosing === "plugins" ? null : "plugins") : onOpenSettings("plugins"))}
          >
            <Toggles label="plugins" items={plugins.map((p) => ({ id: p.name, name: p.name }))} empty="" value={draft.plugins} onChange={(plugins) => change({ plugins })} />
          </AddOn>
          <AddOn
            title="Extensions"
            on={added.filter((x) => draft.extensions.includes(x.id)).map((x) => x.name)}
            none={added.length === 0}
            open={choosing === "extensions"}
            onToggle={() => (added.length ? setChoosing(choosing === "extensions" ? null : "extensions") : onOpenSettings("extensions"))}
          >
            <Toggles label="extensions" items={added} empty="" value={draft.extensions} onChange={(extensions) => change({ extensions })} />
          </AddOn>
        </Section>
        <ErrorText>{error}</ErrorText>
        <div className="flex items-center gap-2">
          {agent && (
            <Button variant="danger" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          )}
          <span className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={!!busy} disabled={!draft.name.trim() || !draft.model}>
            {agent ? "Save" : "Create agent"}
          </Button>
        </div>
      </form>
      {deleting && agent && <DeleteDialog name={agent.name} onDelete={(keepChat) => deleteAgent(agent.id, keepChat).then(onDeleted)} onClose={() => setDeleting(false)} />}
    </Modal>
  );
}

// A titled card of rows.
const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-1.5">
    <h3 className="label">{title}</h3>
    <Card>{children}</Card>
  </section>
);

// The control of a row: a dropdown of a fixed width.
const Pick = ({ children }: { children: ReactNode }) => <div className="w-44">{children}</div>;

// The skills, plugins or extensions an agent can have: what is on, and a list to change it (or to add the first one).
function AddOn({ title, on, none, open, onToggle, children }: { title: string; on: string[]; none: boolean; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <Row title={title} description={none ? "None added yet." : on.length ? on.join(", ") : "None on."} below={open ? children : undefined}>
      <Button size="sm" aria-expanded={none ? undefined : open} onClick={onToggle}>
        {none ? "Add" : open ? "Done" : "Choose"}
      </Button>
    </Row>
  );
}
