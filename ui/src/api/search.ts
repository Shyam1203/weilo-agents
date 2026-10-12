import { request } from "./http";

/** A message that holds what was searched for. */
export interface Found {
  /** The agent's id and name. */
  agent: string;
  name: string;
  speaker: "you" | "agent" | "routine";
  /** When, as an ISO date. */
  at: string;
  /** The words around what was found. */
  snippet: string;
}

/** Your messages and the agents' that hold `query`, in every chat, newest first. */
export const searchChats = (query: string) => request<Found[]>("GET", `/api/search?q=${encodeURIComponent(query)}`);
