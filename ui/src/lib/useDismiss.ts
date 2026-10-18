import { useEffect, useRef, type RefObject } from "react";

export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void, given?: RefObject<T | null>) {
  const own = useRef<T>(null);
  const ref = given ?? own;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);
  return ref;
}
