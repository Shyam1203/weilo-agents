import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark";
const KEY = "weilo.theme";
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

let current: Theme = typeof window === "undefined" ? "system" : read();

/** Sets `data-theme` on <html>; "system" follows prefers-color-scheme. */
export function applyTheme(theme: Theme = current): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function setTheme(theme: Theme): void {
  current = theme;
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    /* private mode: still applies for this visit */
  }
  applyTheme(theme);
  for (const l of listeners) l();
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}
