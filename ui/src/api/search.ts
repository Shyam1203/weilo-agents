import { request } from "./http";

export interface Found {
  agent: string;
  name: string;
  speaker: "you" | "agent" | "action";
  at: string;
  snippet: string;
}

export const searchChats = (query: string) => request<Found[]>("GET", `/api/search?q=${encodeURIComponent(query)}`);
