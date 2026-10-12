// Per-browser conveniences (last agent, theme). Storage can be blocked; nothing depends on it.

export function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Not persisted; that's fine. */
  }
}

export const KEYS = {
  agent: "weilo.agent",
  theme: "weilo.theme",
  seen: "weilo.seen",
  welcomed: "weilo.welcomed",
  sidebar: "weilo.sidebar",
  device: "weilo.device",
} as const;
