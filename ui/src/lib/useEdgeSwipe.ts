import { useEffect, useRef } from "react";
import { zoom } from "./zoom";

/** How close to the left edge (px) a swipe must start, and how far (px) it must go to count. */
const EDGE = 24;
const FAR = 80;

/**
 * Swiping from the left edge to the right goes back, with the screen following the finger. Only where the phone itself
 * has no such gesture: the app opened from the Home Screen on an iPhone or iPad (in Safari, and on Android, the system's
 * back gesture already does it, through `useBackStep`).
 */
export function useEdgeSwipe(onBack: () => void, enabled: boolean) {
  const box = useRef<HTMLElement>(null);
  const back = useRef(onBack);
  back.current = onBack;

  useEffect(() => {
    const el = box.current;
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!el || !enabled || !standalone) return;
    let start: { x: number; y: number } | null = null;
    let dx = 0;
    const settle = (out: boolean) => {
      el.style.transition = "transform 180ms ease-out";
      el.style.transform = out ? "translateX(100%)" : "";
      const done = () => {
        el.style.transition = "";
        el.style.transform = "";
        el.removeEventListener("transitionend", done);
        if (out) back.current();
      };
      el.addEventListener("transitionend", done);
    };
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = e.touches.length === 1 && t.clientX < EDGE ? { x: t.clientX, y: t.clientY } : null;
      dx = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      // A move that is more up and down than sideways is a scroll.
      if (!dx && Math.abs(t.clientY - start.y) > Math.abs(t.clientX - start.x)) return void (start = null);
      dx = Math.max(0, t.clientX - start.x);
      e.preventDefault();
      el.style.transform = `translateX(${dx / zoom()}px)`;
    };
    const onEnd = () => {
      if (!start) return;
      start = null;
      if (dx) settle(dx > FAR);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);
  return box;
}
