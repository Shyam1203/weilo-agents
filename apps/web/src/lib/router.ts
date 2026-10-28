import { useSyncExternalStore } from "react";

export type Route =
  | { name: "home" }
  | { name: "channel"; channelId: string; threadId: string | null }
  | { name: "agent"; agentId: string }
  | { name: "session"; threadId: string }
  | { name: "needs" }
  | { name: "pair"; code: string }
  | { name: "settings" }
  | { name: "routines" }
  | { name: "connections" }
  | { name: "channels" }
  | { name: "agents" }
  | { name: "missing" };

export function parseRoute(pathname: string, search = ""): Route {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [head, a, b] = parts;
  switch (head) {
    case undefined:
      return { name: "home" };
    case "c":
      return a ? { name: "channel", channelId: a, threadId: b ?? null } : { name: "channels" };
    case "a":
      return a ? { name: "agent", agentId: a } : { name: "agents" };
    case "s":
      return a ? { name: "session", threadId: a } : { name: "missing" };
    case "needs-you":
      return { name: "needs" };
    case "pair":
      return { name: "pair", code: new URLSearchParams(search).get("code") ?? "" };
    case "settings":
      return { name: "settings" };
    case "routines":
      return { name: "routines" };
    case "connections":
      return { name: "connections" };
    case "channels":
      return { name: "channels" };
    case "agents":
      return { name: "agents" };
    default:
      return { name: "missing" };
  }
}

export const paths = {
  home: () => "/",
  channel: (channelId: string, threadId?: string | null) =>
    threadId ? `/c/${encodeURIComponent(channelId)}/${encodeURIComponent(threadId)}` : `/c/${encodeURIComponent(channelId)}`,
  overview: (channelId: string) => `/c/${encodeURIComponent(channelId)}/overview`,
  agent: (agentId: string) => `/a/${encodeURIComponent(agentId)}`,
  session: (threadId: string) => `/s/${encodeURIComponent(threadId)}`,
  needs: () => "/needs-you",
  settings: () => "/settings",
  routines: () => "/routines",
  connections: () => "/connections",
  channels: () => "/channels",
  agents: () => "/agents",
  pair: () => "/pair",
};

const listeners = new Set<() => void>();
let current = typeof window === "undefined" ? "/" : window.location.pathname + window.location.search;

function emit(): void {
  current = window.location.pathname + window.location.search;
  for (const l of listeners) l();
}

if (typeof window !== "undefined") window.addEventListener("popstate", emit);

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === window.location.pathname + window.location.search) return;
  if (opts.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  emit();
  window.scrollTo?.(0, 0);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useLocation(): string {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

export function useRoute(): Route {
  const loc = useLocation();
  const q = loc.indexOf("?");
  return parseRoute(q < 0 ? loc : loc.slice(0, q), q < 0 ? "" : loc.slice(q));
}

/** Where a thread lives: a session page, a channel tab, or an agent's own chat. */
export function threadPath(t: { id: string; kind: string; channel_id: string | null; agent_id: string | null }): string {
  if (t.kind === "session") return paths.session(t.id);
  if (t.kind === "chat" && t.channel_id) return paths.channel(t.channel_id, t.id);
  if (t.agent_id) return paths.agent(t.agent_id);
  return paths.home();
}
