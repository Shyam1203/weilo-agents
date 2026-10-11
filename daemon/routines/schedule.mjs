import { fail } from "../common.mjs";

// When a routine is due: wall-clock times in a time zone, and the next time a schedule happens.
// A schedule is { every, times, day?, date? }. `every` is hour, day, weekday, week or once; `times`
// are "HH:MM"; `day` is 0 (Sunday) to 6, for week; `date` is "YYYY-MM-DD", for once.

export const EVERY = ["hour", "day", "weekday", "week", "once"];
export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export const validZone = (zone) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return typeof zone === "string" && zone.length < 64;
  } catch {
    return false;
  }
};

const two = (n) => String(n).padStart(2, "0");

function partsIn(ms, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour, mi: +parts.minute, wd: DAYS.indexOf(parts.weekday.toLowerCase().slice(0, 3)) };
}

// The moment a wall-clock time happens in `zone`: the earlier one when a clock change repeats it,
// and the later one when a clock change skips it (02:30 where the clocks jump from 02:00 to 03:00 is 03:30), as cron does.
function instantOf(y, m, d, h, mi, zone) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const wall = (ms) => {
    const p = partsIn(ms, zone);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  };
  const offset = (ms) => wall(ms) - Math.floor(ms / 60000) * 60000;
  // The offsets a day before and a day after: the two that a clock change in between can make.
  const before = guess - offset(guess - 864e5);
  const after = guess - offset(guess + 864e5);
  const real = [before, after].filter((ms) => wall(ms) === guess);
  return real.length ? Math.min(...real) : Math.max(before, after);
}

const hm = (time) => time.split(":").map(Number);

/** The next time after `after` (ms) that a schedule is due; throws when there is none. */
export function nextRun({ every, times, day, date }, zone, after) {
  if (every === "once") {
    const [y, m, d] = date.split("-").map(Number);
    const at = instantOf(y, m, d, ...hm(times[0]), zone);
    if (at <= after) throw fail(400, "That time has passed");
    return at;
  }
  const now = partsIn(after, zone);
  if (every === "hour") {
    let at = instantOf(now.y, now.m, now.d, now.h, hm(times[0])[1], zone);
    while (at <= after) at += 3600_000;
    return at;
  }
  for (let k = 0; k < 9; k++) {
    const date = new Date(Date.UTC(now.y, now.m - 1, now.d + k));
    const wd = date.getUTCDay();
    if ((every === "weekday" && (wd === 0 || wd === 6)) || (every === "week" && wd !== day)) continue;
    const next = times.map((t) => instantOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), ...hm(t), zone)).find((at) => at > after);
    if (next) return next;
  }
  throw fail(400, "This schedule never runs");
}

/** The date ("YYYY-MM-DD") of a moment in `zone`; today, or tomorrow with `plusDays`. */
export function dateIn(ms, zone, plusDays = 0) {
  const p = partsIn(ms, zone);
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d + plusDays));
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

/** The time ("HH:MM") of a moment in `zone`. */
export const timeIn = (ms, zone) => {
  const p = partsIn(ms, zone);
  return `${two(p.h)}:${two(p.mi)}`;
};
