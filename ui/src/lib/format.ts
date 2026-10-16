const DAY = 24 * 60 * 60 * 1000;
const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The clock time of a moment (seconds), for beside a message. */
export const clockTime = (at: number) => time(at * 1000);
export const fullWhen = (at: number) => new Date(at * 1000).toLocaleString([], { dateStyle: "full", timeStyle: "short" });

const daysApart = (from: number, to: number) => Math.round((startOfDay(to) - startOfDay(from)) / DAY);

// "Today 9:30", "Yesterday 9:30" or "Tomorrow 9:30" (the word for one day away), else the date and time.
function dayAndTime(ms: number, days: number, oneDay: string) {
  if (days <= 0) return `Today ${time(ms)}`;
  if (days === 1) return `${oneDay} ${time(ms)}`;
  return `${new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${time(ms)}`;
}

export const longWhen = (at: number) => dayAndTime(at * 1000, daysApart(at * 1000, Date.now()), "Yesterday");
export const nextWhen = (ms: number) => dayAndTime(ms, daysApart(Date.now(), ms), "Tomorrow");

export function aheadOf(ms: number) {
  const days = daysApart(Date.now(), ms);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  const untilSunday = (7 - new Date().getDay()) % 7;
  if (days <= untilSunday) return "This week";
  return days <= untilSunday + 7 ? "Next week" : "Later";
}

export function inHowLong(ms: number) {
  const minutes = Math.ceil((ms - Date.now()) / 60_000);
  if (minutes < 1) return "in under 1 min";
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes >= 24 * 60) return null;
  return `in ${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}

export const plainText = (markdown: string) =>
  markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/([^\s.,:;!?…])[ \t]*\n\s*(?=\S)/g, "$1 · ")
    .replace(/\s+/g, " ")
    .trim();

export function shortWhen(at: number) {
  const ms = at * 1000;
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / DAY);
  if (days <= 0) return time(ms);
  if (days === 1) return "Yesterday";
  if (days < 7) return new Date(ms).toLocaleDateString([], { weekday: "long" });
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}
