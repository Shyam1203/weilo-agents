import { useSyncExternalStore } from "react";

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (l) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", l);
      return () => m.removeEventListener("change", l);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Desktop and tablet layout at 768px and wider. */
export const useDesktop = () => useMedia("(min-width: 768px)");
