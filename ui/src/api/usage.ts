import { request } from "./http";

export interface Used {
  tokens: number;
  cost: number;
}

export interface UsageDay {
  day: string;
  agents: Record<string, Used>;
}

export const getUsage = () => request<UsageDay[]>("GET", "/api/usage");
