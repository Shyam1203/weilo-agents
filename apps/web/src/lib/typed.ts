// Words typed in a chat's message box but not sent, kept in this browser so a reload
// doesn't lose them. Storage can be blocked (private windows): then they last until the page closes.
const KEY = "weilo.typed";
let cache: Record<string, string> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function all(): Record<string, string> {
  if (cache) return cache;
  try {
    const data: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "{}");
    cache = data && typeof data === "object" && !Array.isArray(data)
      ? Object.fromEntries(Object.entries(data as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"))
      : {};
  } catch {
    cache = {};
  }
  return cache;
}

export function flushTyped(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  try {
    const kept = Object.fromEntries(Object.entries(all()).filter(([, t]) => t.trim() !== ""));
    if (Object.keys(kept).length === 0) globalThis.localStorage?.removeItem(KEY);
    else globalThis.localStorage?.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Blocked or full: kept in memory only.
  }
}

globalThis.addEventListener?.("pagehide", flushTyped);

/** What was typed in this chat and not sent, or "". */
export function loadTyped(threadId: string): string {
  return all()[threadId] ?? "";
}

/** Remembers the box's words for this chat (saved a moment later). Empty forgets them. */
export function saveTyped(threadId: string, text: string): void {
  const map = all();
  if ((map[threadId] ?? "") === text) return;
  if (text.trim()) map[threadId] = text;
  else delete map[threadId];
  if (!timer) timer = setTimeout(flushTyped, 400);
}

/** Forgets words kept for chats that are gone (drafts of new chats stay). */
export function forgetTypedExcept(threadIds: Iterable<string>): void {
  const keep = new Set(threadIds);
  const map = all();
  let changed = false;
  for (const id of Object.keys(map)) {
    if (id.startsWith("new:") || keep.has(id)) continue;
    delete map[id];
    changed = true;
  }
  if (changed && !timer) timer = setTimeout(flushTyped, 400);
}

/** For tests. */
export function resetTyped(): void {
  cache = null;
  if (timer) clearTimeout(timer);
  timer = null;
}
