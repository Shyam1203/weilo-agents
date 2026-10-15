import { request } from "./http";

export type Every = "once" | "hour" | "day" | "weekday" | "week";

export interface Routine {
  id: string;
  title: string;
  task: string;
  every: Every;
  times: string[];
  day?: number;
  date?: string;
  timezone: string;
  nextRunAt: number | null;
  lastError: string | null;
}

export type RoutineInput = Pick<Routine, "title" | "task" | "every" | "times" | "day" | "date">;

export const listRoutines = (agentId: string) => request<Routine[]>("GET", `/api/agents/${agentId}/routines`);
export const addRoutine = (agentId: string, input: RoutineInput) => request<Routine>("POST", `/api/agents/${agentId}/routines`, input);
export const updateRoutine = (agentId: string, id: string, input: RoutineInput) => request<Routine>("PUT", `/api/agents/${agentId}/routines/${id}`, input);
export const removeRoutine = (agentId: string, id: string) => request("DELETE", `/api/agents/${agentId}/routines/${id}`);

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const clock = (time: string) => new Date(2000, 0, 1, Number(time.slice(0, 2)), Number(time.slice(3))).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function describeSchedule({ every, times, day, date, timezone }: Routine) {
  if (every === "hour") return `Every hour at :${times[0].slice(3)}`;
  const zone = timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone ? ` (${timezone.replace(/_/g, " ")})` : "";
  const at = `${times.map(clock).join(" and ")}${zone}`;
  if (every === "once") {
    const [y, m, d] = date!.split("-").map(Number);
    return `Once, ${new Date(y, m - 1, d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at ${at}`;
  }
  if (every === "day") return `Every day at ${at}`;
  if (every === "weekday") return `Weekdays at ${at}`;
  return `${DAY_NAMES[day ?? 1]}s at ${at}`;
}
