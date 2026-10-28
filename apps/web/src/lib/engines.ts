import type { EngineInfo } from "../proto/EngineInfo";
import type { EngineNeed } from "../proto/EngineNeed";

/**
 * Whether an engine can be picked now. Ready engines can; so can ones that only need a
 * sign-in or a key (the person adds those next). Engines that aren't on this computer
 * can't, and say why in their status line. Older hosts send no `ready`: installed means yes.
 */
export function canPick(e: EngineInfo): boolean {
  if (e.ready) return true;
  if (e.needs === "install" || e.needs === "node") return false;
  if (e.needs) return true;
  return e.ready === undefined ? e.installed : false;
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

/** The engine to preselect: the current one if pickable, else the default, else the first pickable. */
export function preferredEngine(engines: EngineInfo[], current?: string | null): string {
  const ok = engines.filter(canPick);
  return (
    (current && ok.find((e) => e.id === current)?.id) ||
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
