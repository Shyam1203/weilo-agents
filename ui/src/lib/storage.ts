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

export const draftKey = (agentId: string) => `weilo.draft.${agentId}`;
