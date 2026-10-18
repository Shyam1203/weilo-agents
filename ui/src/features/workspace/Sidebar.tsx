import { useState } from "react";
import { doingText, type Agent } from "../../api/agents";
import type { Update } from "../../api/app";
import { Avatar } from "../../components/ui/Avatar";
import { Button, IconButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Tag } from "../../components/ui/Tag";
import { plainText, shortWhen } from "../../lib/format";
import { avatarOf } from "../agents/avatars";
import { SearchBox, SearchResults } from "./ChatSearch";
import { useDragOrder } from "./useDragOrder";
import { Dots } from "../chat/WorkingPill";

interface Props {
  agents: Agent[];
  unread: Set<string>;
  selected?: string;
  update?: Update | null;
  onSelect: (id: string) => void;
  onFound: (id: string, query: string, at: number) => void;
  onReorder: (ids: string[]) => Promise<unknown>;
  onNew: () => void;
  onSettings: () => void;
  onAbout: () => void;
  onContact: () => void;
}

export function Sidebar({ agents, unread, selected, update, onSelect, onFound, onReorder, onNew, onSettings, onAbout, onContact }: Props) {
  const { order, dragging, itemProps, wasDrag, moved } = useDragOrder(
    agents.map((a) => a.id),
    onReorder,
  );
  const [query, setQuery] = useState("");
  const shown = order.map((id) => agents.find((a) => a.id === id)).filter((a): a is Agent => !!a);
  return (
    <nav aria-label="Agents" className="flex h-full w-full shrink-0 flex-col border-r border-line bg-panel pb-[var(--safe-bottom)] md:w-72">
      <div className="flex h-14 shrink-0 items-center justify-between pr-4 pl-5">
        <p aria-hidden="true" className="text-[15px] font-semibold tracking-tight">Weilo Agents</p>
        <IconButton icon="plus" label="New agent" onClick={onNew} />
      </div>
      <SearchBox query={query} onQuery={setQuery} />
      {query.trim() ? <SearchResults query={query} agents={agents} onAgent={onSelect} onOpen={(id, at) => onFound(id, query.trim(), at)} /> : (
        <ul className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-1">
          {shown.map((a) => (
            <li key={a.id} {...itemProps(a.id)} className={`relative select-none [-webkit-touch-callout:none] ${dragging === a.id ? "z-10 rounded-xl bg-panel" : ""}`}>
              <button
                type="button"
                onClick={() => wasDrag() || onSelect(a.id)}
                aria-current={a.id === selected}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-[background-color,box-shadow,scale] ${dragging === a.id ? "scale-[1.02] bg-select shadow-lg shadow-black/30" : a.id === selected ? "bg-select" : "hover:bg-select"}`}
              >
                <Avatar spec={avatarOf(a)} size={36} working={!!a.working} doing={a.doing} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={`min-w-0 flex-1 truncate text-[14px] ${unread.has(a.id) ? "font-semibold" : "font-medium"}`}>{a.name}</span>
                    {a.isolated && <Tag>Isolated</Tag>}
                    {a.last && <span className={`shrink-0 text-[11px] ${unread.has(a.id) ? "font-medium text-unread" : "text-ink-3"}`}>{shortWhen(a.last.at)}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1">
                      {a.taken ? (
                        <span className="flex items-center gap-1 truncate text-xs font-medium text-ink">
                          <Icon name="pointer" size={12} className="shrink-0" /> You have the browser
                        </span>
                      ) : a.working ? (
                        <span className="working-dots block truncate text-xs text-working">
                          {doingText(a.doing)}
                          <Dots />
                        </span>
                      ) : (
                        <span className={`block truncate text-xs ${unread.has(a.id) ? "text-ink" : "text-ink-3"}`}>{a.last ? `${a.last.role === "user" ? "You: " : ""}${a.last.shown ? "Showed you something" : plainText(a.last.text)}` : "No messages yet"}</span>
                      )}
                    </span>
                    {unread.has(a.id) && <span role="img" aria-label="Unread reply" className="size-2.5 shrink-0 rounded-full bg-unread" />}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="sr-only">{moved && `${agents.find((a) => a.id === moved.id)?.name ?? "Agent"} moved to ${moved.at} of ${agents.length}.`}</p>
      <div className="flex flex-col border-t border-line p-2">
        {update?.available && (
          <Button variant="ghost" icon="download" onClick={onAbout} className="w-full justify-start text-ink">
            Update {update.latest} is available
          </Button>
        )}
        <div className="flex items-center gap-1">
          <Button variant="ghost" icon="settings" onClick={onSettings} className="flex-1 justify-start">
            Settings
          </Button>
          <IconButton icon="mail" label="Contact us" onClick={onContact} />
        </div>
      </div>
    </nav>
  );
}
