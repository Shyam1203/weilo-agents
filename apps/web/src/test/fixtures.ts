import type { AgentSummary } from "../proto/AgentSummary";
import type { Card } from "../proto/Card";
import type { NeedsYouItem } from "../proto/NeedsYouItem";
import type { Snapshot } from "../proto/Snapshot";
import type { ThreadSummary } from "../proto/ThreadSummary";

export const NOW = new Date("2026-10-28T12:00:00");

export function card(o: Partial<Card> = {}): Card {
  return {
    kind: "approval",
    approval_id: "a1",
    title: "Run the checks",
    body: null,
    details: null,
    risk: "read",
    risk_line: "Changes nothing",
    actions: [
      { id: "no", label: "Not now", primary: false, decision: { kind: "deny" } },
      { id: "yes", label: "Allow", primary: true, decision: { kind: "allow" } },
    ],
    fallback_text: "",
    ...o,
  };
}

export function item(o: Partial<Omit<NeedsYouItem, "card">> & { card?: Partial<Card> } = {}): NeedsYouItem {
  const { card: c, ...rest } = o;
  return {
    approval_id: "a1",
    thread_id: "t1",
    source: "#shop-launch · Ava",
    created_at: new Date("2026-10-28T09:42:00").toISOString(),
    expires_at: new Date("2026-10-29T09:42:00").toISOString(),
    state: "pending",
    ...rest,
    card: card(c),
  };
}

export function agent(o: Partial<AgentSummary> = {}): AgentSummary {
  return { id: "ava", name: "Ava", color: "violet", engine: "pi", model: null, state: "idle", live_line: "", main_thread_id: "ta", ...o };
}

export function thread(o: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: "t1",
    kind: "chat",
    channel_id: "c1",
    agent_id: "ava",
    title: "Launch email",
    state: "idle",
    live_line: "",
    last_seq: 0n,
    engine: null,
    folder: null,
    started_by: null,
    updated_at: "2026-10-28T09:00:00Z",
    ...o,
  };
}

export function snapshot(o: Partial<Snapshot> = {}): Snapshot {
  return {
    agents: [agent()],
    channels: [{ id: "c1", slug: "shop-launch", title: "Shop launch", archived: false, unread: false }],
    threads: [thread()],
    needs_you: [],
    prefs: {
      agents: { shown: true, open: true },
      channels: { shown: true, open: true },
      sessions: { shown: true, open: true },
      archived: { shown: true, open: false },
    },
    setup: { done: true, found_engines: [], keep_awake: false },
    ...o,
  };
}
