import { KEYS, read, write } from "./storage";

export type Theme = "system" | "light" | "dark" | "weilo";

export function getTheme(): Theme {
  const value = read(KEYS.theme);
  return value === "light" || value === "dark" || value === "weilo" ? value : "system";
}

export function setTheme(theme: Theme) {
  write(KEYS.theme, theme === "system" ? null : theme);
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
