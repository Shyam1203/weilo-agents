import type { AvatarSpec } from "../components/ui/Avatar";
import { request } from "./http";

export interface Agent {
  id: string;
  name: string;
  /** "provider/model", or "" for pi's own pick. */
  model: string;
  /** off … max, or "" for the model's default. */
  thinking: string;
  /** Ids of the skills it uses. */
  skills: string[];
  /** Names of the plugins it uses. */
  plugins: string[];
  /** Ids of the extensions it uses. */
  extensions: string[];
  /** Ids of the extensions that come with the app (browser, routines) turned off for it. */
  disabled: string[];
  instructions: string;
  avatar?: AvatarSpec;
  /** Its home in the workspace, where it works: named when it was made, and kept when it is renamed. */
  folder: string;
  /** The newest message of its conversation; `at` in seconds. */
  last?: { role: "user" | "assistant"; text: string; shown?: boolean; at: number } | null;
  /** It is in the middle of a run. */
  working?: boolean;
  /** The tool it is using now ("" between tools). */
  doing?: string | null;
  /** You have taken its browser over: it waits until you give it back. */
  taken?: boolean;
}

export type AgentInput = Omit<Agent, "id" | "folder" | "last" | "working" | "doing" | "taken">;

const DOING: Record<string, string> = { read: "Reading files", bash: "Running a command", edit: "Editing files", write: "Editing files", grep: "Searching files", find: "Searching files", ls: "Searching files", show: "Preparing what to show", routine: "Setting up a routine", browser: "Using the browser", memory: "Saving to memory", fetch_knowledge: "Searching knowledge", ask: "Waiting for your answer" };

/** What an agent is doing, in a few words: a plugin's or extension's tools have many names. */
export const doingText = (tool?: string | null) => (tool ? (DOING[tool] ?? "Using an add-on") : "Working");

export const listAgents = () => request<Agent[]>("GET", document.visibilityState === "visible" ? "/api/agents?seen" : "/api/agents");
export const createAgent = (input: AgentInput) => request<Agent>("POST", "/api/agents", input);
export const updateAgent = (id: string, input: AgentInput) => request<Agent>("PUT", `/api/agents/${id}`, input);
/** The agent list's order, as the user dragged it. */
export const reorderAgents = (ids: string[]) => request("PUT", "/api/agents", { order: ids });
/** With `keepChat` the conversation stays on disk, out of sight; with `keepFiles` its folder stays in the workspace. */
export const deleteAgent = (id: string, keep: { keepChat: boolean; keepFiles: boolean }) => request("DELETE", `/api/agents/${id}`, keep);
