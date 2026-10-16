import { request, RequestError } from "./http";

export interface Outgoing {
  text: string;
  images: string[];
  files: File[];
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

// Each file goes up as it is, then the message names where it was saved.
async function upload(agentId: string, file: File) {
  let res: Response;
  try {
    res = await fetch(`/api/agents/${agentId}/uploads?name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file });
  } catch {
    throw new Error("Cannot connect to Weilo Agents. Make sure it is running.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new RequestError(data?.error || `${file.name} was not sent (${res.status}).`, res.status, data?.pair === true);
  return (data as { path: string }).path;
}

export async function send(agentId: string, { text, images, files }: Outgoing) {
  const paths = await Promise.all(files.map((file) => upload(agentId, file)));
  return request("POST", `/api/agents/${agentId}/message`, { text, images, files: paths });
}
export const answerAsk = (agentId: string, requestId: string, value?: string) => request("POST", `/api/agents/${agentId}/answer`, { request: requestId, value });

export const abort = (agentId: string) => request("POST", `/api/agents/${agentId}/abort`);
export const listCommands = (agentId: string) => request<Command[]>("GET", `/api/agents/${agentId}/commands`);
export const getEarlier = <M>(agentId: string, skip: number) => request<{ messages: M[]; more: boolean }>("GET", `/api/agents/${agentId}/earlier?skip=${skip}`);
export const getContext = (agentId: string) => request<Context | null>("GET", `/api/agents/${agentId}/context`);
export const compactChat = (agentId: string, instructions?: string) => request<Context | null>("POST", `/api/agents/${agentId}/compact`, { instructions });
export const reloadAgent = (agentId: string) => request("POST", `/api/agents/${agentId}/reload`);
export const eventsUrl = (agentId: string) => `/api/agents/${agentId}/events`;
