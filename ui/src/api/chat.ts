import { imageDataUrl } from "../lib/attachments";
import { fetchJson, request } from "./http";

export interface Outgoing {
  text: string;
  images: string[];
  files: File[];
  when?: "now" | "later";
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

async function upload(agentId: string, file: File) {
  const url = `/api/agents/${agentId}/uploads?name=${encodeURIComponent(file.name)}`;
  const data = await fetchJson<{ path: string }>(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file }, `${file.name} was not sent`);
  return data.path;
}

export async function send(agentId: string, { text, images, files, when }: Outgoing) {
  const paths = await Promise.all(files.map((file) => upload(agentId, file)));
  const pictures = await Promise.all(images.map(imageDataUrl));
  return request("POST", `/api/agents/${agentId}/message`, { text, images: pictures, files: paths, when });
}
export const answerAsk = (agentId: string, requestId: string, value?: string) => request("POST", `/api/agents/${agentId}/answer`, { request: requestId, value });

export const unqueue = (agentId: string, text: string, when: "now" | "later") => request("POST", `/api/agents/${agentId}/unqueue`, { text, when });
export const abort = (agentId: string) => request("POST", `/api/agents/${agentId}/abort`);
export const listCommands = (agentId: string) => request<Command[]>("GET", `/api/agents/${agentId}/commands`);
export const getEarlier = <M>(agentId: string, skip: number) => request<{ messages: M[]; more: boolean }>("GET", `/api/agents/${agentId}/earlier?skip=${skip}`);
export const getContext = (agentId: string) => request<Context | null>("GET", `/api/agents/${agentId}/context`);
export const compactChat = (agentId: string, instructions?: string) => request<Context | null>("POST", `/api/agents/${agentId}/compact`, { instructions });
export const reloadAgent = (agentId: string) => request("POST", `/api/agents/${agentId}/reload`);
export const eventsUrl = (agentId: string) => `/api/agents/${agentId}/events`;
