import { request } from "./http";

export interface SecurityCheck {
  ok: boolean;
  title: string;
  detail: string;
}

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

export interface SecurityReport {
  checks: SecurityCheck[];
  activity: AuditEntry[];
}

export const getSecurity = () => request<SecurityReport>("GET", "/api/security");
