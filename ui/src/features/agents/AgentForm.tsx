import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createAgent, deleteAgent, updateAgent, type Agent, type AgentInput } from "../../api/agents";
import { choosableOf, providerOf, shortName, type Model, type Provider } from "../../api/providers";
import type { Extension } from "../../api/extensions";
import type { Plugin } from "../../api/plugins";
import type { Skill } from "../../api/skills";
import { Button } from "../../components/ui/Button";
import { ErrorText, Field } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Card, Row } from "../../components/ui/Row";
import { Select } from "../../components/ui/Select";
import { Switch } from "../../components/ui/Switch";
import type { SettingsPage } from "../settings/SettingsView";
import { Toggles } from "../../components/ui/Toggles";
import { useAction } from "../../lib/useAction";
import { Icon } from "../../components/ui/Icon";
import { STARTERS } from "../setup/starters";
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

const ADD = "+add";

type Draft = AgentInput & { avatar: NonNullable<AgentInput["avatar"]> };

interface Props {
  agent?: Agent;
  providers: Provider[];
  skills: Skill[];
  plugins: Plugin[];
  extensions: Extension[];
  models?: Model[];
  /** The model a new agent starts with. */
  defaultModel?: string;
  /** Open with More options shown (to change the daily limit, say). */
  showMore?: boolean;
  onAddProvider: () => void;
  onOpenSettings: (page: SettingsPage) => void;
  hidden?: boolean;
  onClose: () => void;
  onSaved: (agent: Agent) => Promise<void>;
  onDeleted: () => void;
}

export function AgentForm({ agent, providers, skills, plugins, extensions, models, defaultModel = "", showMore = false, onAddProvider, onOpenSettings, hidden, onClose, onSaved, onDeleted }: Props) {
  const [draft, setDraft] = useState<Draft>(() =>
    agent ? { name: agent.name, model: agent.model, thinking: agent.thinking, skills: agent.skills, plugins: agent.plugins, extensions: agent.extensions, disabled: agent.disabled, instructions: agent.instructions, avatar: avatarOf(agent), isolated: agent.isolated, trusted: agent.trusted, dailyTokens: agent.dailyTokens } : { name: "", model: defaultModel, thinking: "", skills: [], plugins: [], extensions: [], disabled: [], instructions: "", avatar: randomAvatar(), isolated: false, trusted: false, dailyTokens: 0 },
  );
  const [choosing, setChoosing] = useState<"skills" | "plugins" | "extensions" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [more, setMore] = useState(showMore);
  const { busy, error, run } = useAction();
  const change = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const builtIn = extensions.filter((x) => x.builtin);
  const added = extensions.filter((x) => !x.builtin);
  const firstConnected = providers.find((p) => p.connected)?.id ?? "";
  const [providerId, setProviderId] = useState(() => providerOf(agent?.model ?? defaultModel) || firstConnected);
  const ofProvider = choosableOf(models ?? [], providerId);
  const providerOptions = [...providers.filter((p) => p.connected || p.id === providerId).map((p) => ({ value: p.id, label: p.name })), { value: ADD, label: "+ Add provider" }];
  const modelOptions = [...(draft.model && !ofProvider.some((m) => m.id === draft.model) ? [{ value: draft.model, label: draft.model }] : []), ...ofProvider.map((m) => ({ value: m.id, label: shortName(m.name) }))];
  const pickProvider = (id: string) => {
    if (id === ADD) return onAddProvider();
    setProviderId(id);
    change({ model: "" });
  };

  useEffect(() => {
    if (!providerId && firstConnected) setProviderId(firstConnected);
  }, [providerId, firstConnected]);
  // The models arrive after the form opens: a new agent then gets the recommended one.
  useEffect(() => {
    if (agent || draft.model || !defaultModel) return;
    setProviderId(providerOf(defaultModel));
    change({ model: defaultModel });
  }, [defaultModel]);
  const starterNamed = STARTERS.some((s) => s.name === draft.name);

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run("save", async () => onSaved(agent ? await updateAgent(agent.id, draft) : await createAgent(draft)));
  };

  return (
    <Modal title={agent ? "Edit agent" : "New agent"} hidden={hidden} onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-4">
        {!agent && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-ink-3">Start from</span>
            {STARTERS.map((s) => (
              <button
                key={s.name}
                type="button"
                aria-pressed={draft.name === s.name}
                onClick={() => change({ name: !draft.name.trim() || starterNamed ? s.name : draft.name, instructions: s.instructions, avatar: s.avatar })}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${draft.name === s.name ? "border-ink bg-select text-ink" : "border-line text-ink-2 hover:bg-select"}`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        <AvatarPicker value={draft.avatar} onChange={(avatar) => change({ avatar })} />
        <Field label="Name" hint={agent && (agent.isolated ? <>Works in its own folder, <code>isolated/{agent.folder}/</code>.</> : <>Works in its folder, <code>{agent.folder}/</code>, in the workspace.</>)}>
          <input autoFocus value={draft.name} onChange={(e) => change({ name: e.target.value })} placeholder="For example: Research assistant" className="input" />
        </Field>
        <Field label="Instructions">
          <textarea
            value={draft.instructions}
            onChange={(e) => change({ instructions: e.target.value })}
            rows={5}
            placeholder="For example: You are my research assistant. Find primary sources. Summarize them in plain language. Always cite links."
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
        </Section>
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className="flex items-center gap-2 self-start rounded-lg py-1 pr-2 text-[13.5px] font-medium text-ink-2 hover:text-ink">
          <Icon name="chevronRight" size={14} className={`transition-transform ${more ? "rotate-90" : ""}`} />
          More options
          {!more && <span className="font-normal text-ink-3">Thinking, daily limit, browser, skills, plugins, access</span>}
        </button>
        {more && (
          <>
            <Section title="Model settings">
              <Row title="Thinking" description="How much the model thinks before it answers. Models that cannot think ignore this.">
                <Pick>
                  <Select label="Thinking" value={draft.thinking} onChange={(thinking) => change({ thinking })} options={THINKING} />
                </Pick>
              </Row>
              <Row title="Daily token limit" description={`Tokens it may use a day (read and written; context read again from the cache is free). 0 is no limit.${agent ? ` Today: ${(agent.used ?? 0).toLocaleString()}.` : ""}`}>
                <Pick>
                  <input aria-label="Daily token limit" type="number" min={0} step={10000} value={draft.dailyTokens} onChange={(e) => change({ dailyTokens: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className="input" />
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
            <Section title="Access">
              <Row
                title="Isolated"
                description={
                  <>
                    Runs in a sandbox with only its own folder: no workspace, memory, skill library, settings or keys, and no browser unless you turn it on. Your other agents can read (not change) its folder, search its chat, and learn from what it puts in shared/.
                    {agent && draft.isolated !== agent.isolated && " Saving moves its folder and restarts it."}
                  </>
                }
              >
                <Switch label="Isolated" checked={draft.isolated} onChange={(isolated) => change({ isolated, ...(isolated && !draft.disabled.includes("browser") && { disabled: [...draft.disabled, "browser"] }) })} />
              </Row>
              <Row title="Always allow its own changes" description="Changes it asks for to its own instructions, thinking or skills apply without asking you; the chat shows each one. Anything else still asks.">
                <Switch label="Always allow its own changes" checked={draft.trusted} onChange={(trusted) => change({ trusted })} />
              </Row>
            </Section>
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 flex items-center gap-2 border-t border-line bg-raised px-6 py-3">
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
      {deleting && agent && <DeleteDialog name={agent.name} folder={agent.folder} onDelete={(keep) => deleteAgent(agent.id, keep).then(onDeleted)} onClose={() => setDeleting(false)} />}
    </Modal>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-1.5">
    <h3 className="label">{title}</h3>
    <Card>{children}</Card>
  </section>
);

const Pick = ({ children }: { children: ReactNode }) => <div className="pick w-full min-w-0 sm:w-56">{children}</div>;

function AddOn({ title, on, none, open, onToggle, children }: { title: string; on: string[]; none: boolean; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <Row title={title} description={none ? "None added yet." : on.length ? on.join(", ") : "None on."} below={open ? children : undefined}>
      <Button size="sm" aria-expanded={none ? undefined : open} onClick={onToggle}>
        {none ? "Add" : open ? "Done" : "Choose"}
      </Button>
    </Row>
  );
}
