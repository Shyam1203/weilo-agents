import { useEffect, useRef } from "react";

// How close to the bottom (px) the reader must be for new content to pull the view down; scrolling up further stays put.
const NEAR = 80;

/**
 * A scroll box for a chat: it opens at the bottom (the newest messages), then follows new content
 * while the reader is near the bottom. It checks whenever one of `deps` changes: give it what grows
 * (message count, the last message's size).
 */
export function useFollowBottom(deps: unknown[]) {
  const box = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const first = !opened.current && el.scrollHeight > el.clientHeight;
    if (first) opened.current = true;
    if (first || el.scrollHeight - el.scrollTop - el.clientHeight < NEAR) el.scrollTop = el.scrollHeight;
  }, deps);
  return box;
}
