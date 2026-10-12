const DAY = 24 * 60 * 60 * 1000;
const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** For a chat: "Today 6:27 PM", "Yesterday 6:27 PM", "Mon, Oct 3, 6:27 PM". `at` in seconds. */
export function longWhen(at: number) {
  const ms = at * 1000;
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / DAY);
  if (days <= 0) return `Today ${time(ms)}`;
  if (days === 1) return `Yesterday ${time(ms)}`;
  return `${new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${time(ms)}`;
}

/** For a time ahead: "Today 8:00 AM", "Tomorrow 8:00 AM", "Mon, Oct 3, 8:00 AM". `ms` in milliseconds. */
export function nextWhen(ms: number) {
  const days = Math.round((startOfDay(ms) - startOfDay(Date.now())) / DAY);
  if (days <= 0) return `Today ${time(ms)}`;
  if (days === 1) return `Tomorrow ${time(ms)}`;
  return `${new Date(ms).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}, ${time(ms)}`;
}

/** Which part of the calendar a time ahead falls in: "Today", "Tomorrow", "This week" (to Sunday), "Next week" or "Later". `ms` in milliseconds. */
export function aheadOf(ms: number) {
  const days = Math.round((startOfDay(ms) - startOfDay(Date.now())) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  const untilSunday = (7 - new Date().getDay()) % 7; // days left in this week, which ends on Sunday
  if (days <= untilSunday) return "This week";
  return days <= untilSunday + 7 ? "Next week" : "Later";
}

/** How long until a time less than a day ahead: "in under 1 min", "in 5 min", "in 2 h 15 min"; null for a later time. `ms` in milliseconds. */
export function inHowLong(ms: number) {
  const minutes = Math.ceil((ms - Date.now()) / 60_000);
  if (minutes < 1) return "in under 1 min";
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes >= 24 * 60) return null;
  return `in ${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}

/** Markdown as plain text on one line, for a preview: no heading, list, bold or code marks; a link as its text. */
export const plainText = (markdown: string) =>
  markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** For a list: "6:27 PM" today, "Yesterday", "Monday" this week, then "Oct 3". `at` in seconds. */
export function shortWhen(at: number) {
  const ms = at * 1000;
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / DAY);
  if (days <= 0) return time(ms);
  if (days === 1) return "Yesterday";
  if (days < 7) return new Date(ms).toLocaleDateString([], { weekday: "long" });
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}
