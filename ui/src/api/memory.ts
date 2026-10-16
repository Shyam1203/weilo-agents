import { request } from "./http";

export interface MemorySettings {
  /** The Knowledge curator's model, or "" when it is off. */
  model: string;
  /** Agents save notes about the user, and every agent gets them. */
  notes: boolean;
}

export const getMemory = () => request<MemorySettings>("GET", "/api/memory");
export const setMemory = (change: Partial<MemorySettings>) => request<MemorySettings>("PUT", "/api/memory", change);
