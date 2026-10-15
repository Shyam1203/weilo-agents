import { request } from "./http";

export interface MemorySettings {
  model: string;
  ask: boolean;
}

export interface Memory extends MemorySettings {
  text: string;
}

export const getMemory = () => request<Memory>("GET", "/api/memory");
export const saveMemory = (text: string) => request<{ text: string }>("PUT", "/api/memory", { text });
export const setMemorySettings = (change: Partial<MemorySettings>) => request<MemorySettings>("PUT", "/api/memory/curator", change);
