import { useState } from "react";
import type { Action } from "../../api/actions";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { Loading } from "../../components/ui/List";
import { Menu, MenuItem } from "../../components/ui/Menu";
import { shortWhen } from "../../lib/format";

interface Props {
  agentName: string;
  off: boolean;
  actions: Action[] | null;
  error: string | null;
  running: Set<string>;
  onRun: (action: Action) => void;
  onRemove: (action: Action) => Promise<void>;
}

/** The agent's one-tap actions, at the top of the side panel. */
export function ActionsPanel({ agentName, off, actions, error, running, onRun, onRemove }: Props) {
  const [removing, setRemoving] = useState<string | null>(null);
  return (
    <section className="flex flex-col gap-3 p-4">
      <h2 className="text-[13px] font-medium text-ink-2">Actions</h2>
      <ErrorText>{error}</ErrorText>
      {off ? (
        <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] leading-relaxed text-ink-3">Actions are turned off for this agent.</p>
      ) : actions === null ? (
        !error && <Loading />
      ) : actions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] leading-relaxed text-ink-3">No actions yet. When you ask {agentName} for the same thing again, it can offer to save it here as one tap.</p>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-xl ring-1 ring-line">
          {actions.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 border-b border-line px-3 py-2.5 last:border-b-0">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-ink-2">
                  <Icon name={a.icon} size={16} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13.5px] font-medium" title={a.title}>{a.title}</span>
                  <span className={`truncate text-xs ${a.last && !a.last.ok ? "text-bad" : "text-ink-3"}`} title={a.last?.text ?? a.about}>
                    {a.kind === "script" ? "Script" : "Agent"} · {a.last ? `${a.last.text.split("\n")[0]} · ${shortWhen(a.last.at / 1000)}` : a.about || (a.kind === "script" ? "runs without the model, in seconds" : `asks ${agentName}`)}
                  </span>
                </span>
                <Menu
                  trigger={({ open, toggle }) => (
                    <button type="button" aria-label={`More for ${a.title}`} aria-expanded={open} onClick={toggle} className="-mx-1 rounded-md p-1 text-ink-3 hover:bg-select hover:text-ink">
                      <Icon name="chevronDown" size={14} />
                    </button>
                  )}
                >
                  {(close) => <MenuItem icon="close" label="Delete action" onClick={() => (close(), setRemoving(a.id))} />}
                </Menu>
                <button
                  type="button"
                  aria-label={`Run ${a.title}`}
                  title={`Run ${a.title}`}
                  disabled={running.has(a.id)}
                  onClick={() => onRun(a)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink text-page transition-opacity hover:opacity-85 disabled:opacity-50"
                >
                  <Icon name={running.has(a.id) ? "spinner" : "play"} size={14} />
                </button>
              </div>
              {removing === a.id && (
                <div className="flex items-center gap-2 text-xs text-ink-2">
                  <span className="flex-1">Delete "{a.title}"? {agentName} can save it again.</span>
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>Keep</Button>
                  <Button size="sm" variant="danger" onClick={() => void onRemove(a).finally(() => setRemoving(null))}>Delete</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
