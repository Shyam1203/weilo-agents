import { request } from "./http";

export interface Memory {
  text: string;
  model: string;
}

export const getMemory = () => request<Memory>("GET", "/api/memory");
export const saveMemory = (text: string) => request<{ text: string }>("PUT", "/api/memory", { text });
export const setCurator = (model: string) => request<{ model: string }>("PUT", "/api/memory/curator", { model });
