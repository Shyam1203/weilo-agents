import type { Snapshot } from "../proto/Snapshot";
import { paths } from "./router";
import { buildRows, SECTION_KEYS, SECTION_TITLES, type SectionKey } from "./sidebar";

/** What choosing an item does. */
export type JumpAction =
  | { type: "go"; href: string }
  | { type: "new"; what: "agent" | "channel" | "session" }
  | { type: "section"; key: SectionKey; shown: boolean };

export interface JumpItem {
  id: string;
  group: "Go to" | "Do";
  kind: "agent" | "channel" | "session" | "page" | "action";
  label: string;
  /** A short second line: an agent's status, who started a session. */
  sub: string | null;
  action: JumpAction;
  /** Other words it answers to ("hide", "new"). */
  words?: string;
}

/** Everything Ctrl+K can jump to or do: agents, channels and sessions (hidden sections too), pages and actions. */
export function jumpItems(snap: Snapshot, problems: Record<string, string> = {}): JumpItem[] {
  const rows = buildRows(snap, problems);
  const go: JumpItem[] = [
    ...rows.agents.map((r) => ({ id: r.id, group: "Go to" as const, kind: "agent" as const, label: r.name, sub: r.sub, action: { type: "go" as const, href: r.href } })),
    ...[...rows.channels, ...rows.archived].map((r) => ({
      id: r.id,
      group: "Go to" as const,
      kind: "channel" as const,
      label: r.name,
      sub: r.archived ? "Archived" : null,
      action: { type: "go" as const, href: r.href },
    })),
    ...rows.sessions.map((r) => ({ id: r.id, group: "Go to" as const, kind: "session" as const, label: r.name, sub: r.sub, action: { type: "go" as const, href: r.href } })),
    page("needs", "Needs you", paths.needs()),
    page("settings", "Settings", paths.settings(), "preferences theme dark light keys devices"),
    page("routines", "Routines", paths.routines()),
    page("connections", "Connections", paths.connections()),
  ];
  const doing: JumpItem[] = [
    act("new-session", "New session", { type: "new", what: "session" }, "start code work"),
    act("new-agent", "New agent", { type: "new", what: "agent" }, "add make"),
    act("new-channel", "New channel", { type: "new", what: "channel" }, "add make"),
    ...SECTION_KEYS.map((k) => {
      const shown = snap.prefs[k].shown;
      return act(`section-${k}`, `${shown ? "Hide" : "Show"} ${SECTION_TITLES[k]}`, { type: "section", key: k, shown: !shown }, "sidebar section");
    }),
  ];
  return [...go, ...doing];
}

function page(id: string, label: string, href: string, words?: string): JumpItem {
  return { id: `page-${id}`, group: "Go to", kind: "page", label, sub: null, action: { type: "go", href }, words };
}

function act(id: string, label: string, action: JumpAction, words?: string): JumpItem {
  return { id, group: "Do", kind: "action", label, sub: null, action, words };
}

/**
 * The items that match what was typed, best first: names that start with it, then words
 * that start with it, then anything that contains it. A leading # matches channels.
 */
export function searchJump(items: JumpItem[], query: string, limit = 12): JumpItem[] {
  const raw = query.trim().toLowerCase();
  if (!raw) return [];
  const channelOnly = raw.startsWith("#");
  const q = raw.replace(/^#/, "").trim();
  const scored: Array<{ item: JumpItem; score: number; i: number }> = [];
  items.forEach((item, i) => {
    if (channelOnly && item.kind !== "channel") return;
    if (!q) {
      scored.push({ item, score: 3, i });
      return;
    }
    const label = item.label.toLowerCase();
    const words = `${label} ${item.words ?? ""}`.split(/[\s·-]+/);
    let score = -1;
    if (label.startsWith(q)) score = 0;
    else if (words.some((w) => w.startsWith(q))) score = 1;
    else if (label.includes(q) || (item.sub ?? "").toLowerCase().includes(q)) score = 2;
    if (score >= 0) scored.push({ item, score, i });
  });
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.item);
}
