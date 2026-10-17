import type { IconName } from "../components/ui/Icon";
import { request } from "./http";

export interface PinItem {
  text: string;
  done: boolean;
}

export interface Pin {
  id: string;
  kind: "status" | "list";
  title: string;
  icon: IconName;
  source: string;
  value: string;
  detail: string;
  tone: "good" | "bad" | null;
  steps: { done: number; total: number } | null;
  items?: PinItem[];
  history: number[];
  actionId: string | null;
  updatedAt: number;
  changedAt: number;
}

export const listPins = (agentId: string) => request<Pin[]>("GET", `/api/agents/${agentId}/pins`);
export const tickPin = (agentId: string, id: string, index: number, done: boolean) => request<Pin>("POST", `/api/agents/${agentId}/pins/${id}/tick`, { index, done });
export const removePin = (agentId: string, id: string) => request("DELETE", `/api/agents/${agentId}/pins/${id}`);
