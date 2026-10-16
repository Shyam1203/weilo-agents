import { fail } from "../common.mjs";

export const EVERY = ["minutes", "hour", "day", "weekday", "week", "once"];
export const MINUTES = [5, 10, 15, 30];
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

function instantOf(y, m, d, h, mi, zone) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const wall = (ms) => {
    const p = partsIn(ms, zone);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  };
  const offset = (ms) => wall(ms) - Math.floor(ms / 60000) * 60000;
  const before = guess - offset(guess - 864e5);
  const after = guess - offset(guess + 864e5);
  const real = [before, after].filter((ms) => wall(ms) === guess);
  return real.length ? Math.min(...real) : Math.max(before, after);
}

const hm = (time) => time.split(":").map(Number);

export function nextRun({ every, times, day, date, minutes }, zone, after) {
  if (every === "minutes") return (Math.floor(after / 60_000) + minutes) * 60_000;
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

export function dateIn(ms, zone, plusDays = 0) {
  const p = partsIn(ms, zone);
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d + plusDays));
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

export const timeIn = (ms, zone) => {
  const p = partsIn(ms, zone);
  return `${two(p.h)}:${two(p.mi)}`;
};
