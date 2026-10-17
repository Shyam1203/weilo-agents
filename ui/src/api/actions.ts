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
  by: "you" | "schedule";
  ms?: number;
  chat?: boolean;
}

export interface Action {
  id: string;
  title: string;
  about: string;
  kind: "agent" | "script";
  request: string;
  fields: ActionField[];
  icon: IconName;
  schedule: Schedule | null;
  runs: ActionRun[];
}

export type RunResult = { sent: true } | ActionRun;

export const listActions = (agentId: string) => request<Action[]>("GET", `/api/agents/${agentId}/actions`);
export const runAction = (agentId: string, id: string, input: Record<string, string>) => request<RunResult>("POST", `/api/agents/${agentId}/actions/${id}/run`, { input });
export const addAction = (agentId: string, action: { title: string; request: string }) => request<Action>("POST", `/api/agents/${agentId}/actions`, action);
export const changeAction = (agentId: string, id: string, change: { title?: string; request?: string; schedule?: ScheduleInput | null }) => request<Action>("PUT", `/api/agents/${agentId}/actions/${id}`, change);
export const removeAction = (agentId: string, id: string) => request("DELETE", `/api/agents/${agentId}/actions/${id}`);

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const clock = (time: string) => new Date(2000, 0, 1, Number(time.slice(0, 2)), Number(time.slice(3))).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

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
