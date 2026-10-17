import { request } from "./http";

export interface MemorySettings {
  model: string;
  notes: boolean;
}

export const getMemory = () => request<MemorySettings>("GET", "/api/memory");
export const setMemory = (change: Partial<MemorySettings>) => request<MemorySettings>("PUT", "/api/memory", change);
