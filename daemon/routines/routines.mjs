import { randomUUID } from "node:crypto";
import { prompt } from "../agents/runner.mjs";
import { fail, readJson, ROUTINES, updateJson } from "../common.mjs";
import { LATE_MS, MAX_IN_MINUTES, MAX_ROUTINE_TASK, MAX_ROUTINE_TITLE, MAX_ROUTINES, MAX_TIMES, ROUTINES_EVERY_MS, SEND_MS } from "../config.mjs";
import { DAYS, EVERY, dateIn, nextRun, timeIn, validZone } from "./schedule.mjs";

// A routine is work an agent does on a schedule: when it is due, its task goes to the agent's chat
// as a message. routines.json { timezone, items: [{ id, agentId, title, task, every, times, day?,
// date?, timezone, nextRunAt, lastError }] }; the schedule fields are in schedule.mjs. Times are
// wall-clock times in the routine's time zone: the browser's when the user adds it, else the zone
// of the browser that last opened the routines.

const MISSED = "Missed: Weilo Agents was not running at that time";
// Tells the agent how to treat the message. The chat shows only the routine's name. The user is away while it runs, so a
// question would hold the whole run until they come back: what needs them waits for the end instead.
const NOTE = `This is a scheduled routine, not a message from the user. The user is away and will read your reply later. Do the task now:
- Do the steps the task clearly covers.
- When a step needs the user (their approval, a sign-in, a code, a CAPTCHA, or a choice the task does not settle), do not wait for them: leave that step undone, carry on with the rest, and list it at the end with what you need from them.
- End with the result only, in a few lines: what was done, and what waits for the user. Do not mention the schedule.`;

let state;
let loading;
// A routines.json that cannot be read fails the routines only, and is read again the next time.
const load = () =>
  (loading ??= readJson(ROUTINES).then(
    (saved) => (state = { timezone: validZone(saved.timezone) ? saved.timezone : "UTC", items: Array.isArray(saved.items) ? saved.items : [] }),
    (err) => {
      loading = undefined;
      throw err;
    },
  ));

const save = () => updateJson(ROUTINES, () => state);

// A routine's fields from `input`; what it leaves out stays as in `current` (an edit). A one-time
// routine can be given as `in_minutes` (from now) or with `date` "today" or "tomorrow". `at` is the
// moment of `in_minutes`, exact: it does not pass through wall-clock time, which a clock change can repeat.
function fieldsOf(input, current, zone) {
  const text = (value, fallback, max) => (typeof value === "string" ? value.trim().slice(0, max) : fallback);
  const title = text(input.title, current.title, MAX_ROUTINE_TITLE);
  const task = text(input.task, current.task, MAX_ROUTINE_TASK);
  const every = input.every ?? current.every;
  let times = Array.isArray(input.times) ? input.times : (current.times ?? (every === "hour" ? ["00:00"] : []));
  let date = input.date ?? current.date;
  let at;
  if (date === "today" || date === "tomorrow") date = dateIn(Date.now(), zone, date === "tomorrow" ? 1 : 0);
  if (every === "once" && input.in_minutes !== undefined) {
    const minutes = Math.floor(Number(input.in_minutes));
    if (!(minutes >= 1 && minutes <= MAX_IN_MINUTES)) throw fail(400, `Give in_minutes from 1 to ${MAX_IN_MINUTES}`);
    at = Math.floor((Date.now() + minutes * 60_000) / 60_000) * 60_000;
    date = dateIn(at, zone);
    times = [timeIn(at, zone)];
  }
  times = [...new Set(times)].sort();
  const day = every === "week" ? (typeof input.day === "number" ? input.day : DAYS.indexOf(String(input.day ?? DAYS[current.day] ?? "").slice(0, 3).toLowerCase())) : undefined;
  if (!title) throw fail(400, "Type a name for the routine");
  if (!task) throw fail(400, "Type the task for the agent");
  if (!EVERY.includes(every)) throw fail(400, "Choose how often: once, or every hour, day, weekday or week");
  if (!times.length || times.length > MAX_TIMES || !times.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw fail(400, `Give 1 to ${MAX_TIMES} times as HH:MM, for example 08:00`);
  if (every === "week" && !(day >= 0 && day <= 6)) throw fail(400, "Choose the day of the week");
  if (every === "once" && !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw fail(400, "Give the date as YYYY-MM-DD, today, tomorrow, or in_minutes");
  return { title, task, every, times: every === "hour" || every === "once" ? times.slice(0, 1) : times, ...(every === "week" && { day }), ...(every === "once" && { date }), at };
}

const view = ({ id, agentId, title, task, every, times, day, date, timezone, nextRunAt, lastError }) => ({ id, agentId, title, task, every, times, day, date, timezone, nextRunAt, lastError });

const find = (agentId, id) => {
  const routine = state.items.find((r) => r.id === id && r.agentId === agentId);
  if (!routine) throw fail(404, "This routine does not exist");
  return routine;
};

/** Notes the time zone of the browser that opens the routines: the one for routines an agent adds. */
export async function noteZone(zone) {
  await load();
  if (!validZone(zone) || state.timezone === zone) return;
  state.timezone = zone;
  await save();
}

// Soonest first; one that is over (missed, or failed) has no next time and comes last.
export async function listRoutines(agentId) {
  await load();
  return state.items.filter((r) => r.agentId === agentId).sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity)).map(view);
}

/** `zone`: the time zone of its times; the one noted last if none. */
export async function addRoutine(agentId, input, zone) {
  await load();
  if (state.items.filter((r) => r.agentId === agentId).length >= MAX_ROUTINES) throw fail(400, `An agent can have ${MAX_ROUTINES} routines`);
  const timezone = validZone(zone) ? zone : state.timezone;
  const { at, ...fields } = fieldsOf(input, {}, timezone);
  const routine = { id: randomUUID(), agentId, ...fields, timezone, nextRunAt: at ?? nextRun(fields, timezone, Date.now()), lastError: null };
  state.items.push(routine);
  await save();
  return view(routine);
}

export async function updateRoutine(agentId, id, input) {
  await load();
  const routine = find(agentId, id);
  const { at, ...fields } = fieldsOf(input, routine, routine.timezone);
  const nextRunAt = at ?? nextRun(fields, routine.timezone, Date.now());
  // A day or date left over from the old schedule must not stay.
  delete routine.day;
  delete routine.date;
  Object.assign(routine, fields, { nextRunAt, lastError: null });
  await save();
  return view(routine);
}

export async function removeRoutine(agentId, id) {
  await load();
  find(agentId, id);
  state.items = state.items.filter((r) => r.id !== id);
  await save();
}

/** Drops all of an agent's routines (the agent is deleted). */
export async function forgetRoutines(agentId) {
  await load();
  state.items = state.items.filter((r) => r.agentId !== agentId);
  await save();
}

// --- Running them ---

let ticking = false;

const sendWithin = (agentId, text) => {
  let timer;
  const late = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("The agent did not answer")), SEND_MS)));
  return Promise.race([prompt(agentId, { text }), late]).finally(() => clearTimeout(timer));
};

// A routine moves to its next time, and that is saved, before its task is sent: a crash in between
// skips one run and never repeats it. A one-time routine has no next time: it is removed once it ran,
// and stays in the list with its error when it did not.
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await load();
    const now = Date.now();
    const due = state.items.filter((r) => r.nextRunAt !== null && r.nextRunAt <= now);
    const sends = [];
    for (const routine of due) {
      const late = now - routine.nextRunAt > LATE_MS;
      try {
        routine.nextRunAt = routine.every === "once" ? null : nextRun(routine, routine.timezone, now);
      } catch (err) {
        routine.nextRunAt = null;
        routine.lastError = String(err.message).slice(0, 300);
        continue;
      }
      if (!late) sends.push(routine);
      else if (routine.every === "once") routine.lastError = MISSED;
    }
    if (due.length) await save();
    for (const routine of sends) {
      if (!state.items.includes(routine)) continue; // removed while an earlier one was sent
      try {
        // A pi that does not answer must not hold up every other routine.
        await sendWithin(routine.agentId, `⏰ Routine: ${routine.title}\n\n${NOTE}\n\n${routine.task}`);
        routine.lastError = null;
        if (routine.every === "once") state.items = state.items.filter((r) => r !== routine);
      } catch (err) {
        routine.lastError = String(err.message).slice(0, 300);
        // The agent is gone, and so is its routine.
        if (err.status === 404) state.items = state.items.filter((r) => r !== routine);
      }
    }
    if (sends.length) await save();
  } catch (err) {
    console.error("routines:", err);
  } finally {
    ticking = false;
  }
}

/** Looks for due routines every ROUTINES_EVERY_MS. */
export function startRoutines() {
  setInterval(() => void tick(), ROUTINES_EVERY_MS).unref();
  void tick();
}
