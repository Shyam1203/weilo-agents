import { request } from "./http";

export interface Outgoing {
  text: string;
  images: string[];
  files: { name: string; data: string }[];
}

export const fileUrl = (agent: string, path: string, view = false) => `/api/agents/${agent}/files/${path.split("/").map(encodeURIComponent).join("/")}${view ? "?view=1" : ""}`;

export interface Command {
  name: string;
  description: string;
}

export interface Context {
  tokens: number | null;
  window: number;
  point: number;
}

export const send = (agentId: string, message: Outgoing) => request("POST", `/api/agents/${agentId}/message`, message);
export const answerAsk = (agentId: string, requestId: string, value?: string) => request("POST", `/api/agents/${agentId}/answer`, { request: requestId, value });

export const abort = (agentId: string) => request("POST", `/api/agents/${agentId}/abort`);
export const listCommands = (agentId: string) => request<Command[]>("GET", `/api/agents/${agentId}/commands`);
export const getEarlier = <M>(agentId: string, skip: number) => request<{ messages: M[]; more: boolean }>("GET", `/api/agents/${agentId}/earlier?skip=${skip}`);
export const getContext = (agentId: string) => request<Context | null>("GET", `/api/agents/${agentId}/context`);
export const compactChat = (agentId: string, instructions?: string) => request<Context | null>("POST", `/api/agents/${agentId}/compact`, { instructions });
export const reloadAgent = (agentId: string) => request("POST", `/api/agents/${agentId}/reload`);
export const eventsUrl = (agentId: string) => `/api/agents/${agentId}/events`;
