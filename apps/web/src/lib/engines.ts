import type { EngineInfo } from "../proto/EngineInfo";
import type { EngineNeed } from "../proto/EngineNeed";

/**
 * Whether an engine can be picked now. Ready engines can; so can ones that only need a
 * sign-in (when they're on this computer) or a key (the person adds those next; a key-only
 * engine like Weilo's built-in AI downloads on first use). Engines that aren't on this
 * computer can't, and say why in their status line. Older hosts send no `ready`: installed means yes.
 */
export function canPick(e: EngineInfo): boolean {
  if (e.ready) return true;
  if (e.needs === "install" || e.needs === "node") return false;
  // Only the built-in AI is fetched on first use; any other app has to be on this computer.
  if (e.needs === "key") return e.installed || e.id === "pi";
  if (e.needs) return e.installed;
  return e.ready === undefined ? e.installed : false;
}

/**
 * The AI app first run offers as "We found …": one the host found that is really on this
 * computer and can be used. Weilo's built-in AI is never "found"; it has its own card.
 */
export function foundEngine(found: string[], engines: EngineInfo[] | null): EngineInfo | null {
  if (!engines) return null;
  for (const id of found) {
    if (id === "pi") continue;
    const e = engines.find((x) => x.id === id);
    if (e && e.installed && canPick(e)) return e;
  }
  return null;
}

/** "Anthropic, OpenAI or Google": the companies whose key an engine takes. */
export function keyCompanies(e: EngineInfo | undefined): string | null {
  const names = (e?.key_providers ?? []).map((k) => k.title);
  if (names.length === 0) return null;
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** One plain line about an engine: the host's status, else what we can tell ourselves. */
export function statusLine(e: EngineInfo): string {
  if (e.status?.trim()) return e.status.trim();
  if (!e.installed) return "Not on this computer.";
  return e.description;
}

/** Engines to offer: the ones the host lists, pickable first, then the rest in the host's order. */
export function pickOrder(engines: EngineInfo[]): EngineInfo[] {
  return [...engines.filter(canPick), ...engines.filter((e) => !canPick(e))];
}

/**
 * The engine to preselect. Change AI keeps the agent's `current` one. Otherwise only a ready
 * engine is preselected: the one chosen in setup (`chosen`, the main agent's), else the
 * default, else any. Only when none is ready does it fall back to one that needs a sign-in or key.
 */
export function preferredEngine(engines: EngineInfo[], current?: string | null, chosen?: string | null): string {
  const ok = engines.filter(canPick);
  return (
    (current && ok.find((e) => e.id === current)?.id) ||
    (chosen && ok.find((e) => e.id === chosen && e.ready)?.id) ||
    ok.find((e) => e.default && e.ready)?.id ||
    ok.find((e) => e.ready)?.id ||
    ok.find((e) => e.default)?.id ||
    ok[0]?.id ||
    ""
  );
}

/** Where to get an API key, per model company. Opened in a new tab. */
export const KEY_LINKS: Record<string, { url: string; where: string }> = {
  anthropic: { url: "https://console.anthropic.com/settings/keys", where: "Anthropic Console" },
  openai: { url: "https://platform.openai.com/api-keys", where: "OpenAI Platform" },
  google: { url: "https://aistudio.google.com/app/apikey", where: "Google AI Studio" },
};

export type ProblemKind = "retry" | "sign_in" | "key" | "install" | "folder";

/** What a problem's button does, from its label (the host's labels are fixed words). */
export function problemKind(action: string | null | undefined): ProblemKind | null {
  switch (action?.trim().toLowerCase()) {
    case "try again":
      return "retry";
    case "sign in":
      return "sign_in";
    case "add a key":
    case "change key":
    case "change the key":
      return "key";
    case "install":
      return "install";
    case "choose another folder":
      return "folder";
    default:
      return null;
  }
}

/** The kind of help dialog an engine need opens. */
export function needKind(needs: EngineNeed | null | undefined): ProblemKind | null {
  switch (needs) {
    case "sign_in":
      return "sign_in";
    case "key":
      return "key";
    case "install":
    case "node":
      return "install";
    case "error":
      return "retry";
    default:
      return null;
  }
}

/** For comparing lines: no backticks, case, extra spaces or end punctuation. */
function norm(s: string): string {
  return s.replace(/`/g, "").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").toLowerCase();
}

/** True when `message` already says `line` (so the line isn't shown twice). */
export function alreadySays(message: string | null | undefined, line: string | null | undefined): boolean {
  if (!message || !line) return false;
  const l = norm(line);
  return l.length > 0 && norm(message).includes(l);
}

/**
 * The ways an engine can sign in, as one sentence: "You can sign in with ChatGPT or an API key."
 * Null when it named none.
 */
export function signInWays(methods: Array<{ name: string }>): string | null {
  const ways = methods
    .map((m) =>
      m.name
        .trim()
        .replace(/^(sign|log) ?in (with|using) /i, "")
        .replace(/^use /i, "")
        .replace(/[.]+$/, ""),
    )
    .filter(Boolean)
    .map((w) => (/^(A|An|The|Your) /.test(w) ? w[0]!.toLowerCase() + w.slice(1) : w));
  const unique = [...new Set(ways)];
  if (unique.length === 0) return null;
  const list = unique.length === 1 ? unique[0]! : `${unique.slice(0, -1).join(", ")} or ${unique[unique.length - 1]}`;
  return `You can sign in with ${list}.`;
}

/**
 * One plain line for an AI, the same everywhere (first run, Change AI, Settings): its
 * status, like "Not on this computer.". How to fix it is under Details (engineHow).
 */
export function engineLine(e: EngineInfo): string {
  return statusLine(e);
}

/** What to do to use an AI that can't be picked yet ("Get Node.js from nodejs.org…"), for Details. */
export function engineHow(e: EngineInfo): string | null {
  if (canPick(e) || !e.how?.trim()) return null;
  return alreadySays(statusLine(e), e.how) ? null : e.how.trim();
}

// Setup step 1's choice, kept in this browser so a reload doesn't send people back to step 1.
// The host only learns the choice when setup finishes.
const SETUP_KEY = "weilo.setupEngine";

/** The AI chosen in setup step 1 on this device, or null (also when storage is blocked). */
export function loadSetupEngine(storage?: Pick<Storage, "getItem">): string | null {
  try {
    const v = (storage ?? globalThis.localStorage)?.getItem(SETUP_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

export function saveSetupEngine(id: string | null, storage?: Pick<Storage, "setItem" | "removeItem">): void {
  try {
    const st = storage ?? globalThis.localStorage;
    if (id) st?.setItem(SETUP_KEY, id);
    else st?.removeItem(SETUP_KEY);
  } catch {
    // Private windows: setup still works, it just starts at step 1 after a reload.
  }
}

/** Whether a remembered setup choice still holds: null while engines load, then ready-or-not. */
export function setupEngineHolds(id: string, engines: EngineInfo[] | null): boolean | null {
  if (!engines) return null;
  const e = engines.find((x) => x.id === id);
  if (!e) return false;
  return e.ready === true || (e.ready === undefined && e.installed && !e.needs);
}
