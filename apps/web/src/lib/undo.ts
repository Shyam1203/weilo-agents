import { store, undecideLocally, decideLocally, type UndoState } from "./store";

/**
 * Undo for one-click actions that can't be taken back on the host (Discard, Stop, Remove).
 * The screen shows the action as done at once, with "Undo" in a toast; the call goes to the
 * host only when the toast runs out or is dismissed, when another such action starts, or when
 * the page is left. Undo cancels it.
 */
export const UNDO_MS = 6000;

let seq = 0;
let pending: (() => unknown) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function doLater(what: Omit<UndoState, "id">, action: () => unknown, ms = UNDO_MS): void {
  flushUndo();
  const undo: UndoState = { ...what, id: ++seq };
  store.set((s) => {
    const next = { ...s, undo };
    return undo.approvalId ? decideLocally(next, undo.approvalId, false) : next;
  });
  pending = action;
  timer = setTimeout(flushUndo, ms);
}

/** Sends the waiting action now. */
export function flushUndo(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const run = pending;
  pending = null;
  if (!run) return;
  store.set((s) => ({ ...s, undo: null }));
  void run();
}

/** Takes the waiting action back: nothing was sent. */
export function undoPending(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = null;
  store.set((s) => {
    const u = s.undo;
    const next = { ...s, undo: null };
    return u?.approvalId ? undecideLocally(next, u.approvalId, false) : next;
  });
}

export function hasPending(): boolean {
  return pending !== null;
}

/**
 * Leaving the page never drops a waiting action silently: the browser asks first, and if
 * the page goes anyway the action is sent on the way out.
 */
export function installUndoGuards(target: Pick<Window, "addEventListener"> | undefined = globalThis.window): void {
  if (!target) return;
  target.addEventListener("beforeunload", (e: Event) => {
    if (pending) e.preventDefault();
  });
  target.addEventListener("pagehide", () => flushUndo());
}
