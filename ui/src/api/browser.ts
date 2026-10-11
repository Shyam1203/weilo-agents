import { request } from "./http";

/** When agents must ask you first: `rule` says for what. */
export interface Rule {
  ask: boolean;
  rule: string;
}

export const getRule = () => request<Rule>("GET", "/api/browser/rule");
export const saveRule = (rule: Rule) => request<Rule>("PUT", "/api/browser/rule", rule);

/** `taken`: you are using the agent's window, so the agent waits. */
export const browserState = (agentId: string) => request<{ taken: boolean; hasWindow: boolean }>("GET", `/api/agents/${agentId}/browser`);
/** Brings the agent's window to the front of the screen. */
export const showBrowser = (agentId: string) => request("POST", `/api/agents/${agentId}/browser/show`);
/** Stops the agent's run, if it has one, and lets you use its window. */
export const takeOver = (agentId: string) => request("POST", `/api/agents/${agentId}/browser/take-over`);
/** The agent carries on, if you stopped it. */
export const giveBack = (agentId: string) => request("POST", `/api/agents/${agentId}/browser/give-back`);
