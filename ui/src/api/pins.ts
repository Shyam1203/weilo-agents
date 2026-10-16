import type { IconName } from "../components/ui/Icon";
import { request } from "./http";

export interface PinItem {
  text: string;
  done: boolean;
}

/** A small card the agent keeps up to date: a value that changes (a price, an order), or a list. */
export interface Pin {
  id: string;
  kind: "status" | "list";
  title: string;
  icon: IconName;
  /** Where it comes from: "Best Buy". */
  source: string;
  value: string;
  detail: string;
  tone: "good" | "bad" | null;
  steps: { done: number; total: number } | null;
  items?: PinItem[];
  /** The numbers in its value over time, for a small chart. */
  history: number[];
  /** The action that keeps it fresh. */
  actionId: string | null;
  updatedAt: number;
  /** When what it shows last changed. */
  changedAt: number;
}

export const listPins = (agentId: string) => request<Pin[]>("GET", `/api/agents/${agentId}/pins`);
export const tickPin = (agentId: string, id: string, index: number, done: boolean) => request<Pin>("POST", `/api/agents/${agentId}/pins/${id}/tick`, { index, done });
export const removePin = (agentId: string, id: string) => request("DELETE", `/api/agents/${agentId}/pins/${id}`);
