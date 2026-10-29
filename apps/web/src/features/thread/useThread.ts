import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { follow } from "../../lib/app";
import { threadState, useApp } from "../../lib/store";
import type { Event } from "../../proto/Event";
import type { WorkState } from "../../proto/WorkState";

const NO_EVENTS: Event[] = [];

/** Follows a thread while it is on screen. */
export function useFollow(threadId: string | null | undefined): void {
  useEffect(() => (threadId ? follow(threadId) : undefined), [threadId]);
}

export function useEvents(threadId: string): Event[] {
  return useApp((s) => s.feeds[threadId]?.events ?? NO_EVENTS);
}

export function useThreadState(threadId: string): WorkState {
  return useApp((s) => threadState(s.snapshot?.threads.find((t) => t.id === threadId), s.feeds[threadId]));
}

/** How close to the bottom still counts as "at the newest message". */
const NEAR_BOTTOM = 80;

/**
 * Keeps a scroll box pinned to the bottom while new content arrives, unless the person
 * scrolled up. Only the person's own scrolling (wheel, touch, keys, the scrollbar) unpins
 * it: rows that grow as they draw (content-visibility) move the scroll position too, and
 * must not count as scrolling up. Returns whether the newest message is in view, and a
 * way to jump to it.
 */
export function useStickToBottom(ref: RefObject<HTMLElement | null>, key: string): { atBottom: boolean; jump(): void } {
  const pinned = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let userAt = 0;
    const gap = () => el.scrollHeight - el.scrollTop - el.clientHeight;
    const user = () => {
      userAt = performance.now();
    };
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) user();
    };
    const onScroll = () => {
      const near = gap() < NEAR_BOTTOM;
      if (near) pinned.current = true;
      else if (performance.now() - userAt < 1000) pinned.current = false;
      setAtBottom(near || pinned.current);
    };
    const stick = () => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", user, { passive: true });
    el.addEventListener("touchstart", user, { passive: true });
    el.addEventListener("touchmove", user, { passive: true });
    el.addEventListener("pointerdown", user, { passive: true });
    el.addEventListener("keydown", onKey);
    const observer = new ResizeObserver(stick);
    observer.observe(el);
    const watch = () => {
      for (const child of Array.from(el.children)) observer.observe(child);
    };
    watch();
    // Children that come and go (the list, the fade) are watched too.
    const mo = new MutationObserver(() => {
      watch();
      stick();
    });
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", user);
      el.removeEventListener("touchstart", user);
      el.removeEventListener("touchmove", user);
      el.removeEventListener("pointerdown", user);
      el.removeEventListener("keydown", onKey);
      observer.disconnect();
      mo.disconnect();
    };
  }, [ref, key]);
  useLayoutEffect(() => {
    const el = ref.current;
    pinned.current = true;
    setAtBottom(true);
    if (el) el.scrollTop = el.scrollHeight;
  }, [ref, key]);
  const jump = useCallback(() => {
    const el = ref.current;
    pinned.current = true;
    setAtBottom(true);
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [ref]);
  return { atBottom, jump };
}

/** Desktop or phone drawing of the same conversation. */
export const VariantContext = createContext<"desktop" | "phone">("desktop");
export const useVariant = () => useContext(VariantContext);

/** Asks the open message box to take focus (after Edit or Ask Ava). */
export function focusComposer(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("weilo:focus-composer"));
}

let composerFocusWanted = false;

/** Like focusComposer, for a page that is about to open: its message box takes focus when it shows. */
export function focusComposerSoon(): void {
  composerFocusWanted = true;
  // A page that kept its message box: no new box takes the request, so ask the open one.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (takeComposerFocus()) focusComposer();
    }),
  );
}

/** True once after focusComposerSoon (the message box calls this when it mounts). */
export function takeComposerFocus(): boolean {
  const wanted = composerFocusWanted;
  composerFocusWanted = false;
  return wanted;
}
