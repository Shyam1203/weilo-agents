import type { Snapshot } from "../proto/Snapshot";
import { paths, type Route } from "./router";
import { buildRows, SECTION_KEYS, SECTION_TITLES, type SectionKey } from "./sidebar";

/** What choosing an item does. */
export type JumpAction =
  | { type: "go"; href: string }
  | { type: "new"; what: "agent" | "channel" | "session" }
  | { type: "section"; key: SectionKey; shown: boolean };

export interface JumpItem {
  id: string;
  group: "Recent" | "Go to" | "Do";
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
 * The items that match what was typed, best first: names that start with it, then names
 * with a word that starts with it ("ge" finds #general, not "New agent"). Only when nothing
 * starts that way does a name that merely contains it count. A leading # matches channels.
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
    // Names and titles only: a status line ("working", "needs you") isn't something you jump to.
    else if (label.includes(q)) score = 2;
    if (score >= 0) scored.push({ item, score, i });
  });
  scored.sort((a, b) => a.score - b.score || a.i - b.i);
  const starts = scored.filter((x) => x.score < 2);
  return (starts.length ? starts : scored).slice(0, limit).map((s) => s.item);
}

/**
 * Ctrl+K before anything is typed: the places you were last (newest first, up to 5; your
 * agents when there's no history yet), then the common things to do.
 */
export function startJump(items: JumpItem[], recent: string[], limit = 5): JumpItem[] {
  const places = items.filter((i) => i.action.type === "go");
  const seen = new Set<string>();
  const out: JumpItem[] = [];
  for (const href of recent) {
    const hit = places.find((i) => i.action.type === "go" && i.action.href === href);
    if (hit && !seen.has(hit.id)) {
      seen.add(hit.id);
      out.push({ ...hit, group: "Recent" });
    }
    if (out.length >= limit) break;
  }
  for (const i of places) {
    if (out.length >= Math.min(limit, 3)) break;
    if (i.kind === "agent" && !seen.has(i.id)) {
      seen.add(i.id);
      out.push({ ...i, group: "Recent" });
    }
  }
  const common = items.filter((i) => i.action.type === "new");
  return [...out, ...common];
}

// The places opened lately, kept in this browser (a convenience: empty is fine).
const RECENT_KEY = "weilo.recentPlaces";
const RECENT_MAX = 8;

export function loadRecent(storage?: Pick<Storage, "getItem">): string[] {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(RECENT_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Puts a place first in the recent list (and saves it); returns the new list. */
export function rememberPlace(href: string, list: string[], storage?: Pick<Storage, "setItem">): string[] {
  const next = [href, ...list.filter((h) => h !== href)].slice(0, RECENT_MAX);
  try {
    (storage ?? globalThis.localStorage)?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private windows: the list just isn't kept.
  }
  return next;
}

let recentNow: string[] | null = null;

/** The recent places, newest first. */
export function recentPlaces(): string[] {
  return (recentNow ??= loadRecent());
}

/** Notes the page being looked at as a recent place (the home page is the main agent). */
export function notePlace(route: Route, mainAgentId: string | null): void {
  const href =
    route.name === "home" ? (mainAgentId ? paths.agent(mainAgentId) : null)
    : route.name === "channel" ? paths.channel(route.channelId)
    : route.name === "agent" ? paths.agent(route.agentId)
    : route.name === "session" ? paths.session(route.threadId)
    : null;
  if (href) recentNow = rememberPlace(href, recentPlaces());
}
