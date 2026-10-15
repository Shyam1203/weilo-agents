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

export function useUnread(agents: Agent[], open?: string) {
  const seen = useRef(seenOf());
  const [, again] = useReducer((n: number) => n + 1, 0);

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
