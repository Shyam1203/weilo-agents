import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches now, and again when it changes. */
export const useMedia = (query: string) =>
  useSyncExternalStore(
    (notify) => {
      const list = matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => matchMedia(query).matches,
  );
