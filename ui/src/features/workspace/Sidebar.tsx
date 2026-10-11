import { doingText, type Agent } from "../../api/agents";
import { Avatar } from "../../components/ui/Avatar";
import { Button, IconButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { shortWhen } from "../../lib/format";
import { avatarOf } from "../agents/avatars";

interface Props {
  agents: Agent[];
  /** The agents with a reply you have not seen. */
  unread: Set<string>;
  selected?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSkills: () => void;
  onPlugins: () => void;
  onSettings: () => void;
}

export function Sidebar({ agents, unread, selected, onSelect, onNew, onSkills, onPlugins, onSettings }: Props) {
  return (
    <nav aria-label="Agents" className="flex h-full w-full shrink-0 flex-col border-r border-line bg-panel md:w-72">
      <div className="flex h-14 shrink-0 items-center justify-between pr-4 pl-5">
        <h1 className="text-[15px] font-semibold tracking-tight">Weilo Agents</h1>
        <IconButton icon="plus" label="New agent" onClick={onNew} />
      </div>
      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-1">
        {agents.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onSelect(a.id)}
              aria-current={a.id === selected}
              className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${a.id === selected ? "bg-select" : "hover:bg-select"}`}
            >
              <span className="relative shrink-0">
                <Avatar spec={avatarOf(a)} size={36} working={!!a.working} />
                {unread.has(a.id) && <span role="img" aria-label="Unread reply" className="absolute -top-0.5 -right-0.5 size-3.5 rounded-full bg-[#ff7a00] ring-2 ring-panel" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={`min-w-0 flex-1 truncate text-[14px] ${unread.has(a.id) ? "font-semibold" : "font-medium"}`}>{a.name}</span>
                  {a.last && <span className="shrink-0 text-[11px] text-ink-3">{shortWhen(a.last.at)}</span>}
                </span>
                {a.taken ? (
                  <span className="flex items-center gap-1 truncate text-xs font-medium text-live">
                    <Icon name="pointer" size={12} className="shrink-0" /> You have the browser
                  </span>
                ) : a.working ? (
                  <span className="working-dots block truncate text-xs text-working">
                    {doingText(a.doing)}
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                  </span>
                ) : (
                  <span className={`block truncate text-xs ${unread.has(a.id) ? "text-ink" : "text-ink-3"}`}>{a.last ? `${a.last.role === "user" ? "You: " : ""}${a.last.shown ? "Showed you something" : a.last.text}` : "No messages yet"}</span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-col border-t border-line p-2">
        <Button variant="ghost" icon="sparkle" onClick={onSkills} className="w-full justify-start">
          Skills
        </Button>
        <Button variant="ghost" icon="puzzle" onClick={onPlugins} className="w-full justify-start">
          Plugins
        </Button>
        <Button variant="ghost" icon="settings" onClick={onSettings} className="w-full justify-start">
          Settings
        </Button>
      </div>
    </nav>
  );
}
