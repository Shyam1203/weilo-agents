// Dragging an agent to a new place in the list. With a mouse it starts as soon as the pointer moves; with a finger, after
// holding the agent still for a moment, so a quick swipe still scrolls the list.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { zoom } from "../../lib/zoom";

/** How long (ms) a finger holds an agent before it lifts and can be dragged. */
const HOLD_MS = 350;
/** How far (px) a pointer moves before a mouse drag starts, or a finger's hold is taken as a scroll instead. */
const SLOP = 6;

interface Drag {
  id: string;
  /** Where the pointer is, and where it held the agent (from the agent's top). */
  y: number;
  startY: number;
  grab: number;
  mouse: boolean;
  /** The agent is lifted and follows the pointer. */
  active: boolean;
  timer?: number;
}

/**
 * `ids` in the list's order; `onDrop` saves a new one (the list keeps showing it until that is done).
 * Returns the order to show, the agent being dragged, and the handlers for each agent's element.
 */
export function useDragOrder(ids: string[], onDrop: (ids: string[]) => Promise<unknown>) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const items = useRef(new Map<string, HTMLElement>());
  const drag = useRef<Drag | null>(null);
  // The click that ends a drag does not also open the agent.
  const dropped = useRef(false);
  const shown = order ?? ids;
  const current = useRef(shown);
  current.current = shown;

  // The lifted agent sits under the pointer, wherever its place in the list is now.
  const place = () => {
    const d = drag.current;
    const el = d?.active && items.current.get(d.id);
    if (!d || !el) return;
    el.style.transform = "";
    el.style.transform = `translateY(${(d.y - d.grab - el.getBoundingClientRect().top) / zoom()}px)`;
  };
  useLayoutEffect(place, [order]);

  const lift = () => {
    const d = drag.current;
    if (!d) return;
    d.active = true;
    setOrder(current.current);
    setDragging(d.id);
    navigator.vibrate?.(10);
  };

  const end = (keep: boolean) => {
    const d = drag.current;
    drag.current = null;
    window.removeEventListener("pointermove", listeners.move);
    window.removeEventListener("pointerup", listeners.up);
    window.removeEventListener("pointercancel", listeners.cancel);
    if (!d) return;
    clearTimeout(d.timer);
    if (!d.active) return;
    const el = items.current.get(d.id);
    if (el) el.style.transform = "";
    dropped.current = true;
    setTimeout(() => (dropped.current = false));
    setDragging(null);
    const next = current.current;
    if (!keep || next.join() === ids.join()) return setOrder(null);
    void onDrop(next).finally(() => setOrder(null));
  };

  // Where the lifted agent goes: after every other agent whose middle is above its own.
  function move(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    d.y = e.clientY;
    if (!d.active) {
      if (Math.abs(d.y - d.startY) < SLOP) return;
      // A finger that moves before the hold is up scrolls the list.
      return d.mouse ? lift() : end(false);
    }
    const el = items.current.get(d.id);
    if (!el) return;
    const middle = d.y - d.grab + el.getBoundingClientRect().height / 2;
    const others = current.current.filter((id) => id !== d.id);
    const before = others.filter((id) => {
      const rect = items.current.get(id)?.getBoundingClientRect();
      return rect && rect.top + rect.height / 2 < middle;
    }).length;
    const next = [...others.slice(0, before), d.id, ...others.slice(before)];
    if (next.join() !== current.current.join()) setOrder(next);
    else place();
  }
  // The window listens while a pointer is down: the same functions every render (so they can be removed again), each
  // calling this render's handlers.
  const latest = useRef({ move, end });
  latest.current = { move, end };
  const [listeners] = useState(() => ({
    move: (e: PointerEvent) => latest.current.move(e),
    up: () => latest.current.end(true),
    cancel: () => latest.current.end(false),
  }));

  // While an agent is lifted, a finger's move drags it instead of scrolling the list. On the document: the list itself
  // comes and goes (search results take its place).
  useEffect(() => {
    const hold = (e: TouchEvent) => drag.current?.active && e.preventDefault();
    document.addEventListener("touchmove", hold, { passive: false });
    return () => (document.removeEventListener("touchmove", hold), latest.current.end(false));
  }, []);

  const itemProps = (id: string) => ({
    ref: (el: HTMLElement | null) => void (el ? items.current.set(id, el) : items.current.delete(id)),
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || drag.current) return;
      const mouse = e.pointerType === "mouse";
      const d: Drag = { id, y: e.clientY, startY: e.clientY, grab: e.clientY - e.currentTarget.getBoundingClientRect().top, mouse, active: false };
      if (!mouse) d.timer = window.setTimeout(lift, HOLD_MS);
      drag.current = d;
      window.addEventListener("pointermove", listeners.move);
      window.addEventListener("pointerup", listeners.up);
      window.addEventListener("pointercancel", listeners.cancel);
    },
    // A long press would open the browser's menu for the link or button.
    onContextMenu: (e: React.MouseEvent) => drag.current && e.preventDefault(),
    // Alt + arrow up or down moves the agent with the keyboard.
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      const from = shown.indexOf(id);
      const to = from + (e.key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to >= shown.length) return;
      const next = [...shown];
      [next[from], next[to]] = [next[to], next[from]];
      setOrder(next);
      void onDrop(next).finally(() => setOrder(null));
    },
  });

  return { order: shown, dragging, itemProps, wasDrag: () => dropped.current };
}
