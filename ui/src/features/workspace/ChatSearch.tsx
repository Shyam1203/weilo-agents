// Searching from the agent list: the box, the agents whose name holds the words, then the messages that do, newest first.
import { useEffect, useState } from "react";
import type { Agent } from "../../api/agents";
import { messageOf } from "../../api/http";
import { searchChats, type Found } from "../../api/search";
import { Avatar } from "../../components/ui/Avatar";
import { Icon } from "../../components/ui/Icon";
import { shortWhen } from "../../lib/format";
import { MAX_SEARCH } from "../../lib/limits";
import { avatarOf } from "../agents/avatars";

/** How long (ms) typing pauses before the search runs. */
const PAUSE_MS = 250;

/** The search box. */
export function SearchBox({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  return (
    <div className="relative mx-3 mb-1.5">
      <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
      <input
        type="search"
        enterKeyHint="search"
        value={query}
        maxLength={MAX_SEARCH}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onQuery("")}
        placeholder="Search chats"
        aria-label="Search chats"
        className="w-full rounded-lg bg-card py-1.5 pr-2.5 pl-8 text-[13.5px] outline-none placeholder:text-ink-3 focus:ring-1 focus:ring-line-strong"
      />
    </div>
  );
}

// The snippet with the words marked.
function Snippet({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-[color-mix(in_srgb,var(--color-unread)_30%,transparent)] text-ink">{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

/** The results for `query`: choosing an agent opens its chat; choosing a message opens that chat at that message. */
export function SearchResults({ query, agents, onAgent, onOpen }: { query: string; agents: Agent[]; onAgent: (agent: string) => void; onOpen: (agent: string, at: number) => void }) {
  const [found, setFound] = useState<Found[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const words = query.trim();
  useEffect(() => {
    setFound(null);
    setError(null);
    const timer = setTimeout(() => void searchChats(words).then(setFound, (e) => setError(messageOf(e))), PAUSE_MS);
    return () => clearTimeout(timer);
  }, [words]);

  // Agents match at once, by name; messages once the search answers.
  const named = agents.filter((a) => a.name.toLowerCase().includes(words.toLowerCase()));
  const note = error ? <p className="px-3 py-2 text-xs text-bad">{error}</p> : !found ? <p className="px-3 py-2 text-xs text-ink-3">Searching messages…</p> : null;
  if (found && !found.length && !named.length) return <p className="px-5 py-3 text-xs text-ink-3">No agents or messages with “{words}”.</p>;
  return (
    <ul aria-label="Search results" className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 py-1">
      {named.length > 0 && <li className="px-2.5 pt-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Agents</li>}
      {named.map((a) => (
        <li key={a.id}>
          <button type="button" onClick={() => onAgent(a.id)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-select">
            <Avatar spec={avatarOf(a)} size={28} />
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
              <Snippet text={a.name} query={words} />
            </span>
          </button>
        </li>
      ))}
      {named.length > 0 && (note || found?.length) ? <li className="px-2.5 pt-2 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Messages</li> : null}
      {note && <li>{note}</li>}
      {found?.map((f, i) => {
        const agent = agents.find((a) => a.id === f.agent);
        const at = Date.parse(f.at) / 1000;
        return (
          <li key={i}>
            <button type="button" onClick={() => onOpen(f.agent, at)} className="flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-select">
              {agent && <Avatar spec={avatarOf(agent)} size={28} />}
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{f.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-3">{shortWhen(at)}</span>
                </span>
                <span className="line-clamp-2 text-xs leading-relaxed text-ink-2">
                  {f.speaker === "you" ? "You: " : ""}
                  <Snippet text={f.snippet} query={words} />
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
