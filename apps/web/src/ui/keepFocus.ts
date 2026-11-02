import { useCallback, useLayoutEffect, useRef, type FocusEvent } from "react";

/**
 * Keeps keyboard focus in a box whose button goes away once used (Allow, Try again, Save key):
 * when focus was inside and falls to the page, the box itself takes it, so the next Tab
 * carries on from here instead of the top of the page.
 */
export function useKeepFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const inside = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !inside.current) return;
    const at = document.activeElement;
    if (at && at !== document.body) return;
    // The box can take focus only for this; it isn't a Tab stop.
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
  });
  const onFocus = useCallback(() => {
    inside.current = true;
  }, []);
  const onBlur = useCallback((e: FocusEvent<T>) => {
    // Going elsewhere on purpose (a dialog, another row): no longer ours. A removed button
    // blurs with nowhere to go, which is the case kept.
    const to = e.relatedTarget as Node | null;
    if (to && !e.currentTarget.contains(to)) inside.current = false;
  }, []);
  return { ref, onFocus, onBlur };
}
