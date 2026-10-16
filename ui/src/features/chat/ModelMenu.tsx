import { useState } from "react";
import { changeAgent, type Agent } from "../../api/agents";
import { messageOf } from "../../api/http";
import { shortName, type Model, type Provider } from "../../api/providers";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Menu, MenuItem } from "../../components/ui/Menu";
import { modelChoices } from "../../lib/models";

interface Props {
  agent: Agent;
  models?: Model[];
  providers: Provider[];
  busy: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
  /** Show it as a "Change model" button (in a problem notice) instead of the model's name. */
  button?: boolean;
}

/** The agent's model in the chat header: pick another without opening Edit agent. */
export function ModelMenu({ agent, models, providers, busy, onChanged, onError, button = false }: Props) {
  const [saving, setSaving] = useState<string | null>(null);
  const choices = modelChoices(models, providers);
  const current = saving ?? agent.model;
  const name = current ? shortName(models?.find((m) => m.id === current)?.name ?? current) : "Choose a model";
  const pick = (model: string) => {
    if (model === agent.model) return;
    setSaving(model);
    changeAgent(agent.id, { model }).then(onChanged, (err) => onError(messageOf(err))).finally(() => setSaving(null));
  };
  return (
    <Menu
      placement={button ? "above-start" : "below-start"}
      wide
      trigger={({ open, toggle }) =>
        button ? (
          <Button size="sm" icon="chevronDown" busy={!!saving} aria-expanded={open} aria-haspopup="menu" onClick={toggle}>
            Change model
          </Button>
        ) : (
          <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="menu" title="Change the model" className="-mx-1 flex min-w-0 items-center gap-0.5 rounded px-1 transition-colors hover:bg-select hover:text-ink">
            <span className="truncate">{name}</span>
            {saving ? <Icon name="spinner" size={11} className="shrink-0" /> : <Icon name="chevronDown" size={12} className="shrink-0" />}
          </button>
        )
      }
    >
      {(close) => (
        <>
          {busy && <p className="px-2.5 pt-1.5 pb-1 text-xs text-ink-3">The new model takes over when this reply ends.</p>}
          {choices.length ? (
            choices.map((c) => <MenuItem key={c.value} icon={c.value === agent.model ? "check" : undefined} label={c.label} onClick={() => (close(), pick(c.value))} />)
          ) : (
            <p className="px-2.5 py-2 text-xs text-ink-3">{models ? "Connect a provider in Settings to choose a model." : "Loading models…"}</p>
          )}
        </>
      )}
    </Menu>
  );
}
