import { randomUUID } from "node:crypto";
import { prompt } from "../agents/runner.mjs";
import { fail, readJson, ROUTINES, updateJson } from "../common.mjs";
import { LATE_MS, MAX_IN_MINUTES, MAX_ROUTINE_TASK, MAX_ROUTINE_TITLE, MAX_ROUTINES, MAX_TIMES, ROUTINES_EVERY_MS, SEND_MS } from "../config.mjs";
import { DAYS, EVERY, dateIn, nextRun, timeIn, validZone } from "./schedule.mjs";

const MISSED = "Missed: Weilo Agents was not running at that time";
const NOTE = `This is a scheduled routine, not a message from the user. The user is away and will read your reply later. Do the task now:
- Do the steps the task clearly covers.
- When a step needs the user (their approval, a sign-in, a code, a CAPTCHA, or a choice the task does not settle), do not wait for them: leave that step undone, carry on with the rest, and list it at the end with what you need from them.
- End with the result only, in a few lines: what was done, and what waits for the user. Do not mention the schedule.`;

let state;
let loading;
const load = () =>
  (loading ??= readJson(ROUTINES).then(
    (saved) => (state = { timezone: validZone(saved.timezone) ? saved.timezone : "UTC", items: Array.isArray(saved.items) ? saved.items : [] }),
    (err) => {
      loading = undefined;
      throw err;
    },
  ));

const save = () => updateJson(ROUTINES, () => state);

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

export const userZone = async () => (await load(), state.timezone);

export async function noteZone(zone) {
  await load();
  if (!validZone(zone) || state.timezone === zone) return;
  const moving = state.items.filter((r) => r.timezone === state.timezone && r.every !== "once" && r.nextRunAt !== null);
  const next = moving.map((r) => nextRun(r, zone, Date.now()));
  moving.forEach((r, i) => Object.assign(r, { timezone: zone, nextRunAt: next[i] }));
  state.timezone = zone;
  await save();
}

export async function listRoutines(agentId) {
  await load();
  return state.items.filter((r) => r.agentId === agentId).sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity)).map(view);
}

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

export async function forgetRoutines(agentId) {
  await load();
  state.items = state.items.filter((r) => r.agentId !== agentId);
  await save();
}

let ticking = false;

const failed = (routine, err) => {
  routine.lastError = String(err.message).slice(0, 300);
  if (err.status === 404) state.items = state.items.filter((r) => r !== routine);
};

// A routine that is done once is removed only when its message was taken: if that fails after the
// wait, it stays, with the error, for the user to see.
const sendWithin = (routine, text) => {
  let timer;
  const sent = prompt(routine.agentId, { text }).then(() => {
    if (routine.every === "once") state.items = state.items.filter((r) => r !== routine);
  });
  const late = new Promise((resolve) => (timer = setTimeout(resolve, SEND_MS)));
  late.then(() => void sent.then(save, (err) => (failed(routine, err), save())));
  return Promise.race([sent, late]).finally(() => clearTimeout(timer));
};

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
      else routine.lastError = MISSED;
    }
    if (due.length) await save();
    for (const routine of sends) {
      if (!state.items.includes(routine)) continue;
      try {
        routine.lastError = null;
        await sendWithin(routine, `⏰ Routine: ${routine.title}\n\n${NOTE}\n\n${routine.task}`);
      } catch (err) {
        failed(routine, err);
      }
    }
    if (sends.length) await save();
  } catch (err) {
    console.error("routines:", err);
  } finally {
    ticking = false;
  }
}

export function startRoutines() {
  setInterval(() => void tick(), ROUTINES_EVERY_MS).unref();
  void tick();
}
