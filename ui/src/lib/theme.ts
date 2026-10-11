// Light, dark, Weilo (brand colours, light or dark by system setting), or follow the system.
// index.html applies the stored choice before first paint, so it repeats the storage key
// ("weilo.theme") and the names: change both together.
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
