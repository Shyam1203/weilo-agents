import { request } from "./http";

export interface AuditEntry {
  at: string;
  event: string;
  by?: string;
  id?: string;
  rid?: string;
  agent?: string;
  question?: string;
  answer?: string;
  name?: string;
  reason?: string;
}

export const listActivity = () => request<AuditEntry[]>("GET", "/api/activity");
