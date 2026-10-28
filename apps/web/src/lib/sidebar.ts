import type { AgentSummary } from "../proto/AgentSummary";
import type { SectionPrefs } from "../proto/SectionPrefs";
import type { Snapshot } from "../proto/Snapshot";
import type { UiPrefs } from "../proto/UiPrefs";
import type { WorkState } from "../proto/WorkState";
import { paths } from "./router";
import { slugText, startedByName } from "./format";

export type SectionKey = keyof UiPrefs;
export const SECTION_KEYS: SectionKey[] = ["agents", "channels", "sessions", "archived"];

export const SECTION_TITLES: Record<SectionKey, string> = {
  agents: "Agents",
  channels: "Channels",
  sessions: "Sessions",
  archived: "Archived",
};

export type RowTone = "ok" | "warn" | "quiet";

export interface SidebarRow {
  id: string;
  kind: "agent" | "channel" | "session";
  name: string;
  sub: string | null;
  tone: RowTone;
  href: string;
  state: WorkState;
  unread: boolean;
  archived?: boolean;
  agent?: AgentSummary;
}

export interface SidebarSection {
  key: SectionKey;
  title: string;
  rows: SidebarRow[];
  prefs: SectionPrefs;
}

function toneOf(state: WorkState): RowTone {
  return state === "needs_you" ? "warn" : state === "working" ? "ok" : "quiet";
}

function worst(states: WorkState[]): WorkState {
  if (states.includes("needs_you")) return "needs_you";
  if (states.includes("working")) return "working";
  return "idle";
}

export function buildRows(snap: Snapshot): Record<SectionKey, SidebarRow[]> {
  const agents: SidebarRow[] = snap.agents.map((a) => ({
    id: a.id,
    kind: "agent",
    name: a.name,
    sub: a.live_line || null,
    tone: a.state === "idle" ? "quiet" : toneOf(a.state),
    href: paths.agent(a.id),
    state: a.state,
    unread: false,
    agent: a,
  }));
  const channelRow = (c: Snapshot["channels"][number]): SidebarRow => ({
    id: c.id,
    kind: "channel",
    name: slugText(c.slug),
    sub: null,
    tone: "quiet",
    href: paths.channel(c.id),
    state: worst(snap.threads.filter((t) => t.channel_id === c.id && t.kind === "chat").map((t) => t.state)),
    unread: c.unread,
    archived: c.archived,
  });
  const channels = snap.channels.filter((c) => !c.archived).map(channelRow);
  const archived = snap.channels.filter((c) => c.archived).map(channelRow);
  const sessions: SidebarRow[] = snap.threads
    .filter((t) => t.kind === "session")
    .map((t) => {
      const by = startedByName(t.started_by, snap.agents);
      const state = t.state === "idle" ? "" : ` · ${t.state === "needs_you" ? "needs you" : "working"}`;
      return {
        id: t.id,
        kind: "session",
        name: t.title,
        sub: `Started by ${by}${state}`,
        tone: toneOf(t.state),
        href: paths.session(t.id),
        state: t.state,
        unread: false,
      };
    });
  return { agents, channels, sessions, archived };
}

/**
 * What a folded section says: only its most urgent state ("1 needs you", "1 working", "1 new"), or nothing.
 */
export function collapsedLabel(rows: SidebarRow[]): string {
  const needs = rows.filter((r) => r.state === "needs_you").length;
  if (needs) return `${needs} needs you`;
  const working = rows.filter((r) => r.state === "working").length;
  if (working) return `${working} working`;
  const fresh = rows.filter((r) => r.unread).length;
  if (fresh) return `${fresh} new`;
  return "";
}

export function hasLiveWork(rows: SidebarRow[]): boolean {
  return rows.some((r) => r.state !== "idle");
}

export function matches(row: SidebarRow, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (!q) return true;
  return row.name.toLowerCase().includes(q) || (row.sub ?? "").toLowerCase().includes(q);
}

/**
 * The sections to draw, in order. Sessions show once one exists; Archived once a channel is archived.
 */
export function buildSections(snap: Snapshot, query = ""): SidebarSection[] {
  const rows = buildRows(snap);
  return SECTION_KEYS.filter((k) => snap.prefs[k].shown)
    .filter((k) => (k === "sessions" || k === "archived" ? rows[k].length > 0 : true))
    .map((key) => ({
      key,
      title: SECTION_TITLES[key],
      prefs: snap.prefs[key],
      rows: rows[key].filter((r) => matches(r, query)),
    }));
}

/** True when a hidden section has something working or waiting, so Customize shows a dot. */
export function hiddenHasLiveWork(snap: Snapshot): boolean {
  const rows = buildRows(snap);
  return SECTION_KEYS.some((k) => !snap.prefs[k].shown && hasLiveWork(rows[k]));
}

export function allHidden(prefs: UiPrefs): boolean {
  return SECTION_KEYS.every((k) => !prefs[k].shown);
}

export function withSection(prefs: UiPrefs, key: SectionKey, patch: Partial<SectionPrefs>): UiPrefs {
  return { ...prefs, [key]: { ...prefs[key], ...patch } };
}

export function showAll(prefs: UiPrefs): UiPrefs {
  return {
    agents: { ...prefs.agents, shown: true },
    channels: { ...prefs.channels, shown: true },
    sessions: { ...prefs.sessions, shown: true },
    archived: { ...prefs.archived, shown: true },
  };
}
