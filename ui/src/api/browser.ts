import { request } from "./http";

export interface Rule {
  ask: boolean;
  rule: string;
}

export const getRule = () => request<Rule>("GET", "/api/browser/rule");
export const saveRule = (rule: Rule) => request<Rule>("PUT", "/api/browser/rule", rule);

export const browserState = (agentId: string) => request<{ taken: boolean; hasWindow: boolean }>("GET", `/api/agents/${agentId}/browser`);
export const showBrowser = (agentId: string) => request("POST", `/api/agents/${agentId}/browser/show`);
export const takeOver = (agentId: string) => request("POST", `/api/agents/${agentId}/browser/take-over`);
export const giveBack = (agentId: string) => request("POST", `/api/agents/${agentId}/browser/give-back`);
