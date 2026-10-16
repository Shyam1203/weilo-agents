import type { IconName } from "../components/ui/Icon";
import { request } from "./http";

export interface ActionField {
  name: string;
  label: string;
  options?: string[];
  default?: string;
}

export type Every = "once" | "minutes" | "hour" | "day" | "weekday" | "week";

export interface Schedule {
  every: Every;
  times: string[];
  minutes?: number;
  day?: number;
  date?: string;
  timezone: string;
  nextRunAt: number | null;
}

export type ScheduleInput = Pick<Schedule, "every" | "times" | "minutes" | "day" | "date">;

export interface ActionRun {
  at: number;
  ok: boolean;
  text: string;
  /** Tapped by you, or started by its schedule. */
  by: "you" | "schedule";
  ms?: number;
  /** An agent action's run: its answer is the agent's reply in the chat. */
  chat?: boolean;
  /** It ran by itself and waits for you to confirm before it goes ahead. */
  waiting?: boolean;
}

export interface Action {
  id: string;
  title: string;
  about: string;
  /** agent: a request to the agent; script: runs in seconds without the agent ("Instant"). */
  kind: "agent" | "script";
  request: string;
  fields: ActionField[];
  /** Ask the user first, before it pays, orders, books or sends. */
  confirm: boolean;
  icon: IconName;
  /** When it also runs by itself. */
  schedule: Schedule | null;
  /** The newest first. */
  runs: ActionRun[];
}

export type RunResult = { sent: true } | ActionRun;

export const listActions = (agentId: string) => request<Action[]>("GET", `/api/agents/${agentId}/actions`);
export const runAction = (agentId: string, id: string, input: Record<string, string>) => request<RunResult>("POST", `/api/agents/${agentId}/actions/${id}/run`, { input });
export const addAction = (agentId: string, action: { title: string; request: string }) => request<Action>("POST", `/api/agents/${agentId}/actions`, action);
export const changeAction = (agentId: string, id: string, change: { title?: string; request?: string; schedule?: ScheduleInput | null; confirm?: boolean }) => request<Action>("PUT", `/api/agents/${agentId}/actions/${id}`, change);
export const skipAction = (agentId: string, id: string) => request("POST", `/api/agents/${agentId}/actions/${id}/skip`);
export const removeAction = (agentId: string, id: string) => request("DELETE", `/api/agents/${agentId}/actions/${id}`);

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const clock = (time: string) => new Date(2000, 0, 1, Number(time.slice(0, 2)), Number(time.slice(3))).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** When an action runs by itself, in plain words: "Every morning at 8:00 AM". */
export function describeSchedule(s: Schedule) {
  const at = s.times.map(clock).join(" and ");
  if (s.every === "minutes") return `Every ${s.minutes} minutes`;
  if (s.every === "hour") return `Every hour at :${s.times[0].slice(3)}`;
  if (s.every === "day") return `Every day at ${at}`;
  if (s.every === "weekday") return `Weekdays at ${at}`;
  if (s.every === "week") return `${DAYS[s.day ?? 1]}s at ${at}`;
  const [y, m, d] = (s.date ?? "").split("-").map(Number);
  return `Once, ${new Date(y, m - 1, d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at ${at}`;
}

/** The last run that finished (not one waiting for you). */
export const lastRun = (a: Action) => a.runs.find((r) => !r.waiting);
