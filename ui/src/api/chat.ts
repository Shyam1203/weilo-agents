import { request } from "./http";

/** What a message carries: images as data URLs, files as base64. */
export interface Outgoing {
  text: string;
  images: string[];
  files: { name: string; data: string }[];
}

/** Where a file in the workspace can be viewed or downloaded. */
export const fileUrl = (path: string) => `/api/files/${path.split("/").map(encodeURIComponent).join("/")}`;

/** A skill the agent can run as a /command. */
export interface Command {
  name: string;
  description: string;
}

/** How full an agent's context is: `tokens` (null just after a summary) of the model's `window`; pi summarizes at `point`. */
export interface Context {
  tokens: number | null;
  window: number;
  point: number;
}

export const send = (agentId: string, message: Outgoing) => request("POST", `/api/agents/${agentId}/message`, message);
/** Answers the question the agent waits on; no `value` skips it. */
export const answerAsk = (agentId: string, requestId: string, value?: string) => request("POST", `/api/agents/${agentId}/answer`, { request: requestId, value });

export const abort = (agentId: string) => request("POST", `/api/agents/${agentId}/abort`);
export const listCommands = (agentId: string) => request<Command[]>("GET", `/api/agents/${agentId}/commands`);
export const getContext = (agentId: string) => request<Context | null>("GET", `/api/agents/${agentId}/context`);
/** Summarizes the conversation now; `instructions` say what to keep. Returns the context after it. */
export const compactChat = (agentId: string, instructions?: string) => request<Context | null>("POST", `/api/agents/${agentId}/compact`, { instructions });
/** Starts the agent's pi anew, so it reads its skills, instructions, notes and extensions again. */
export const reloadAgent = (agentId: string) => request("POST", `/api/agents/${agentId}/reload`);
export const eventsUrl = (agentId: string) => `/api/agents/${agentId}/events`;
