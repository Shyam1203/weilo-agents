import type { IconName } from "../components/ui/Icon";
import { request } from "./http";

export interface ActionField {
  name: string;
  label: string;
  options?: string[];
  default?: string;
}

export interface Action {
  id: string;
  title: string;
  about: string;
  /** agent: a saved request to the agent; script: code that runs without the model. */
  kind: "agent" | "script";
  request: string;
  fields: ActionField[];
  /** Ask the user before it pays, orders, books or sends. */
  confirm: boolean;
  icon: IconName;
  last: { at: number; ok: boolean; text: string } | null;
}

export type ActionRun = { sent: true } | { ok: boolean; text: string; ms: number; at: number };

export const listActions = (agentId: string) => request<Action[]>("GET", `/api/agents/${agentId}/actions`);
export const runAction = (agentId: string, id: string, input: Record<string, string>) => request<ActionRun>("POST", `/api/agents/${agentId}/actions/${id}/run`, { input });
export const removeAction = (agentId: string, id: string) => request("DELETE", `/api/agents/${agentId}/actions/${id}`);
