import { createContext, useContext, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
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

/** Keeps a scroll box pinned to the bottom while new content arrives, unless the person scrolled up. */
export function useStickToBottom(ref: RefObject<HTMLElement | null>, key: string): void {
  const pinned = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => {
      el.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [ref, key]);
  useLayoutEffect(() => {
    const el = ref.current;
    pinned.current = true;
    if (el) el.scrollTop = el.scrollHeight;
  }, [ref, key]);
}

/** Desktop or phone drawing of the same conversation. */
export const VariantContext = createContext<"desktop" | "phone">("desktop");
export const useVariant = () => useContext(VariantContext);

/** Asks the open message box to take focus (after Edit or Ask Ava). */
export function focusComposer(): void {
  window.dispatchEvent(new CustomEvent("weilo:focus-composer"));
}
