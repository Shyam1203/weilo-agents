import { useEffect, useRef } from "react";

// How close to the bottom (px) the reader must be for new content to pull the view down; scrolling up further stays put.
const NEAR = 80;

/**
 * A scroll box for a chat: it opens at the bottom (the newest messages), then follows new content
 * while the reader is at the bottom. It checks whenever one of `deps` changes: give it what grows
 * (message count, the last message's size). Where the reader is is noted as they scroll, not when
 * content arrives (a tall block would otherwise look like scrolled away), and kept while the box
 * is hidden (Settings is open over the chat).
 */
export function useFollowBottom(deps: unknown[]) {
  const box = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const atBottom = useRef(true);
  const top = useRef(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onScroll = () => {
      if (!el.clientHeight) return;
      top.current = el.scrollTop;
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR;
    };
    // Hidden boxes lose their scroll position; it returns when the box is shown again.
    let height = el.clientHeight;
    const watch = new ResizeObserver(() => {
      if (!height && el.clientHeight) el.scrollTop = atBottom.current ? el.scrollHeight : top.current;
      height = el.clientHeight;
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    watch.observe(el);
    return () => (el.removeEventListener("scroll", onScroll), watch.disconnect());
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el || !el.clientHeight) return;
    const first = !opened.current && el.scrollHeight > el.clientHeight;
    if (first) opened.current = true;
    if (first || atBottom.current) el.scrollTop = el.scrollHeight;
  }, deps);
  return box;
}
