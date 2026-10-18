import { useEffect, useRef, useState } from "react";

const NEAR = 80;

export function useFollowBottom(deps: unknown[]) {
  const box = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const atBottom = useRef(true);
  const top = useRef(0);
  const [away, setAway] = useState(false);
  const [unseen, setUnseen] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onScroll = () => {
      if (!el.clientHeight) return;
      top.current = el.scrollTop;
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR;
      setAway(!atBottom.current);
      if (atBottom.current) setUnseen(false);
    };
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
    else if (opened.current) setUnseen(true);
  }, deps);

  const toBottom = () => box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  const stick = () => {
    const el = box.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  };
  return { box, away, unseen, toBottom, stick };
}
