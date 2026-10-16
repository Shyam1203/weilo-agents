import { useState } from "react";
import { changeAgent, type Agent } from "../../api/agents";
import { messageOf } from "../../api/http";
import type { Model, Provider } from "../../api/providers";
import { Button } from "../../components/ui/Button";
import { Menu, MenuItem } from "../../components/ui/Menu";
import { modelChoices } from "../../lib/models";

interface Props {
  agent: Agent;
  models?: Model[];
  providers: Provider[];
  busy: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}

/** "Change model" in a problem notice: pick another model without opening Edit agent. */
export function ChangeModel({ agent, models, providers, busy, onChanged, onError }: Props) {
  const [saving, setSaving] = useState<string | null>(null);
  const choices = modelChoices(models, providers);
  const pick = (model: string) => {
    if (model === agent.model) return;
    setSaving(model);
    changeAgent(agent.id, { model }).then(onChanged, (err) => onError(messageOf(err))).finally(() => setSaving(null));
  };
  return (
    <Menu
      placement="above-start"
      wide
      trigger={({ open, toggle }) => (
        <Button size="sm" icon="chevronDown" busy={!!saving} aria-expanded={open} aria-haspopup="menu" onClick={toggle}>
          Change model
        </Button>
      )}
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
