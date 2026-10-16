import type { AvatarSpec } from "../components/ui/Avatar";
import { request } from "./http";

export interface Agent {
  id: string;
  name: string;
  model: string;
  thinking: string;
  skills: string[];
  plugins: string[];
  extensions: string[];
  disabled: string[];
  instructions: string;
  avatar?: AvatarSpec;
  folder: string;
  isolated: boolean;
  trusted: boolean;
  dailyTokens: number;
  used?: number;
  last?: { role: "user" | "assistant"; text: string; shown?: boolean; at: number } | null;
  working?: boolean;
  doing?: string | null;
  taken?: boolean;
}

export type AgentInput = Omit<Agent, "id" | "folder" | "used" | "last" | "working" | "doing" | "taken">;

const DOING: Record<string, string> = { read: "Reading files", bash: "Running a command", edit: "Editing files", write: "Editing files", grep: "Searching files", find: "Searching files", ls: "Searching files", show: "Preparing what to show", routine: "Setting up a routine", browser: "Using the browser", memory: "Saving to memory", fetch_knowledge: "Searching knowledge", ask: "Waiting for your answer", skill: "Saving a skill", manage_agents: "Setting up an agent", manage_settings: "Changing settings", ask_agent: "Asking another agent" };

export const doingText = (tool?: string | null) => (tool ? (DOING[tool] ?? "Using an add-on") : "Working");

export const AGENT_STATUS_URL = "/api/agents/status";
export const listAgents = () => request<Agent[]>("GET", document.visibilityState === "visible" ? "/api/agents?seen" : "/api/agents");
export const createAgent = (input: AgentInput) => request<Agent>("POST", "/api/agents", input);
export const updateAgent = (id: string, input: AgentInput) => request<Agent>("PUT", `/api/agents/${id}`, input);
export const reorderAgents = (ids: string[]) => request("PUT", "/api/agents", { order: ids });
export const deleteAgent = (id: string, keep: { keepChat: boolean; keepFiles: boolean }) => request("DELETE", `/api/agents/${id}`, keep);
