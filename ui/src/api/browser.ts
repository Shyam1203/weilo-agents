import { request } from "./http";

export const browserState = (agentId: string) => request<{ taken: boolean; hasWindow: boolean; teaching: number | null }>("GET", `/api/agents/${agentId}/browser`);
export const showBrowser = (agentId: string) => request("POST", `/api/agents/${agentId}/browser/show`);
export const takeOver = (agentId: string) => request("POST", `/api/agents/${agentId}/browser/take-over`);
export const startTeaching = (agentId: string) => request("POST", `/api/agents/${agentId}/browser/teach`);
export const finishTeaching = (agentId: string, goal: string) => request("POST", `/api/agents/${agentId}/browser/teach/done`, { goal });
export const giveBack = (agentId: string) => request("POST", `/api/agents/${agentId}/browser/give-back`);
