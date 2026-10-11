import { useEffect, useReducer, useRef } from "react";
import type { Agent } from "../../api/agents";
import { KEYS, read, write } from "../../lib/storage";

const seenOf = (): Record<string, number> => {
  try {
    return JSON.parse(read(KEYS.seen) ?? "{}");
  } catch {
    return {};
  }
};

/**
 * The agents whose newest message is a reply you haven't seen: newer than when you last had their
 * chat open. `open` is the agent whose chat is on screen. Kept per browser; what is already there
 * on first sight counts as seen.
 */
export function useUnread(agents: Agent[], open?: string) {
  const seen = useRef(seenOf());
  const [, again] = useReducer((n: number) => n + 1, 0);

  // A tab that comes back to the front has seen the open chat.
  useEffect(() => {
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, []);

  const visible = document.visibilityState === "visible";
  for (const { id, last } of agents) {
    if (seen.current[id] === undefined || (visible && id === open)) seen.current[id] = last?.at ?? 0;
  }
  useEffect(() => write(KEYS.seen, JSON.stringify(seen.current)));

  return new Set(agents.filter(({ id, last }) => last?.role === "assistant" && last.at > seen.current[id]).map((a) => a.id));
}
