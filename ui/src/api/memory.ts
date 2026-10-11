import { request } from "./http";

/** `text` is the MEMORY.md file; `model` is the knowledge curator's model, "" while it is off. */
export interface Memory {
  text: string;
  model: string;
}

export const getMemory = () => request<Memory>("GET", "/api/memory");
export const saveMemory = (text: string) => request<{ text: string }>("PUT", "/api/memory", { text });
export const setCurator = (model: string) => request<{ model: string }>("PUT", "/api/memory/curator", { model });
