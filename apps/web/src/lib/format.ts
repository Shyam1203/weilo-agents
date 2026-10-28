import type { AgentSummary } from "../proto/AgentSummary";
import type { WorkState } from "../proto/WorkState";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** "shop-launch" or "#Shop-Launch" → "shop-launch". Shown after a quiet `#`. */
export function slugText(slug: string): string {
  return slug.trim().replace(/^#+/, "").toLowerCase();
}

/** "#shop-launch" */
export function channelLabel(slug: string): string {
  return `#${slugText(slug)}`;
}

/** What a new channel's name will look like: lowercase, at most two words joined by a hyphen. */
export function slugPreview(title: string): string {
  const words = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2);
  return words.join("-");
}

/** "9:41" — the time without AM/PM, like the mock. */
export function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).formatToParts(d);
  return parts
    .filter((p) => p.type !== "dayPeriod")
    .map((p) => p.value)
    .join("")
    .trim();
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "9:41", "Yesterday" or "Mon 12". */
export function whenLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (isSameDay(d, now)) return timeOf(iso);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (isSameDay(d, y)) return "Yesterday";
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days > 0 && days < 7) return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(d);
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" }).format(d);
}

/** Who started a session, in plain words. */
export function startedByName(startedBy: string | null, agents: AgentSummary[]): string {
  if (!startedBy) return "you";
  const v = startedBy.trim();
  if (!v || /^(you|user|me|person)$/i.test(v)) return "you";
  const agent = agents.find((a) => a.id === v || a.name.toLowerCase() === v.toLowerCase());
  return agent ? agent.name : v;
}

export function stateWord(state: WorkState): string {
  return state === "needs_you" ? "needs you" : state === "working" ? "working" : "idle";
}

/** "about $0.38" from micro-dollars. */
export function dollars(micros: bigint): string {
  const v = Number(micros) / 1_000_000;
  return `about $${v < 10 ? v.toFixed(2) : v.toFixed(0)}`;
}

/** The first name of an agent ("Mia · Social" → "Mia"). */
export function shortName(name: string): string {
  return name.split("·")[0]!.trim();
}

/** Plain engine names. Ids come from the host; titles from ListEngines when we have them. */
export function engineTitle(id: string, titles?: Array<{ id: string; title: string }>): string {
  if (id === "pi") return "Weilo's built-in AI";
  const known = titles?.find((e) => e.id === id)?.title;
  if (known) return known;
  const map: Record<string, string> = {
    "claude-code": "Claude Code",
    claude: "Claude Code",
    codex: "Codex",
    gemini: "Gemini CLI",
    "gemini-cli": "Gemini CLI",
    opencode: "OpenCode",
  };
  return map[id] ?? id;
}

/** A project's plain name: the last part of its folder ("~/code/shop" → "shop"). */
export function projectName(folder: string | null | undefined): string | null {
  if (!folder) return null;
  const parts = folder.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

/** "Agents, Channels and Sessions" in the reader's language. */
export function listWords(words: string[], locale?: string): string {
  try {
    return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(words);
  } catch {
    return words.join(", ");
  }
}

/** A computer's name for the middle of a sentence: "Your MacBook" → "your MacBook". */
export function lowerYour(name: string | null | undefined): string | null {
  if (!name) return null;
  return name.replace(/^Your\b/, "your");
}
