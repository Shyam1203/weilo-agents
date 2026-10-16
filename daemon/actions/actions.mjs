import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { audit } from "../audit.mjs";
import { ACTIONS, fail, OLD_SCHEDULES, readJson, updateJson } from "../common.mjs";
import { ACTION_MS, ACTION_SHOWN, ACTIONS_EVERY_MS, LATE_MS, MAX_ACTION_ABOUT, MAX_ACTION_FIELDS, MAX_ACTION_OUTPUT, MAX_ACTION_REQUEST, MAX_ACTION_RUNS, MAX_ACTION_SCRIPT, MAX_ACTION_TITLE, MAX_ACTIONS, MAX_IN_MINUTES, MAX_TIMES, PORT } from "../config.mjs";
import { dropScriptKey, scriptKey } from "../http/access.mjs";
import { getAgent, homeOf, isIsolated, userHomeOf, userOf } from "../agents/agents.mjs";
import { askUser, prompt, tellChats } from "../agents/runner.mjs";
import { notify } from "../push.mjs";
import { passedOn, sharedTools, spawnAs } from "../users.mjs";
import { pinLine, pinsOf, unlinkPins, updateFromAction } from "./pins.mjs";
import { DAYS, EVERY, MINUTES, dateIn, nextRun, timeIn, validZone } from "./schedule.mjs";

export const KINDS = ["agent", "script"];
export const ICONS = ["bolt", "package", "food", "cart", "truck", "calendar", "mail", "money", "search", "globe", "tag", "list"];
export const ACTION_MARK = "⚡ Action: ";
// A run the schedule started: its message's first line ends with this, and the agent is told the user is away.
export const BY_ITSELF = " · ran by itself";
// The app's chat hides these lines under an action's message; keep them in step with conversation.ts.
// Every agent action carries CONFIRM_NOTE: the agent asks before it pays or sends, tapped or by itself.
export const CONFIRM_NOTE = "Before you pay, order, book or send anything, use ask to confirm the exact details with the user.";
// An agent action that keeps pins fresh ends with this and the pins' ids; the chat hides it too.
export const PIN_NOTE = "Then update its pin with the pin tool: ";
export const AWAY_NOTE = "This action ran by itself at its time; the user is away and reads your reply later. Do it now. If a step needs the user's confirmation, use ask: they get a notification and answer when they can. Anything else that needs them, leave for the end. End with the result in a few lines.";
const MISSED = "Missed: Weilo Agents was not running at that time";
const RUNNER = fileURLToPath(new URL("./run.mjs", import.meta.url));

let state;
let loading;
const save = () => updateJson(ACTIONS, () => state);

// Tasks older versions kept in their own file, with a time to run, become agent actions with a schedule.
const fromOld = (r, zone) => ({
  id: typeof r.id === "string" ? r.id : randomUUID(),
  agentId: r.agentId,
  title: String(r.title ?? "Task").slice(0, MAX_ACTION_TITLE),
  about: "",
  kind: "agent",
  request: String(r.task ?? ""),
  script: "",
  fields: [],
  icon: "calendar",
  schedule: r.nextRunAt === null && r.every === "once" ? null : { every: r.every, times: r.times ?? [], ...(r.every === "week" && { day: r.day }), ...(r.every === "once" && { date: r.date }), timezone: r.timezone ?? zone, nextRunAt: r.nextRunAt ?? null },
  runs: r.lastError ? [{ at: Date.now(), ok: false, text: r.lastError, by: "schedule" }] : [],
});

const load = () =>
  (loading ??= (async () => {
    const saved = await readJson(ACTIONS);
    state = { timezone: validZone(saved.timezone) ? saved.timezone : null, items: Array.isArray(saved.items) ? saved.items : [] };
    const old = await readJson(OLD_SCHEDULES);
    if (Array.isArray(old.items) || old.timezone) {
      state.timezone ??= validZone(old.timezone) ? old.timezone : null;
      for (const r of old.items ?? []) if (r?.agentId && r.task) state.items.push(fromOld(r, state.timezone ?? "UTC"));
      state.timezone ??= "UTC";
      await save();
      await rm(OLD_SCHEDULES, { force: true });
      await rm(`${OLD_SCHEDULES}.bak`, { force: true });
    }
    state.timezone ??= "UTC";
  })().catch((err) => {
    loading = undefined;
    throw err;
  }));

export const userZone = async () => (await load(), state.timezone);

/** The user's browser is in another time zone now: schedules on the old one move with it. */
export async function noteZone(zone) {
  await load();
  if (!validZone(zone) || state.timezone === zone) return;
  for (const a of state.items) {
    const s = a.schedule;
    if (!s || s.timezone !== state.timezone || s.every === "once" || s.nextRunAt === null) continue;
    s.timezone = zone;
    s.nextRunAt = nextRun(s, zone, Date.now());
  }
  state.timezone = zone;
  await save();
}

const text = (value, max, what) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw fail(400, `${what} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw fail(400, `${what} is too long: ${max} characters at most`);
  return trimmed;
};

function fieldsOf(list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list) || list.length > MAX_ACTION_FIELDS) throw fail(400, `Give at most ${MAX_ACTION_FIELDS} fields`);
  const fields = list.map((f) => {
    const name = typeof f?.name === "string" ? f.name.trim() : "";
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(name)) throw fail(400, `A field needs a name in lowercase letters, digits and _, like "tracking_number"`);
    const options = f.options === undefined ? undefined : Array.isArray(f.options) && f.options.length <= 12 ? f.options.map((o) => text(String(o), 60, "An option")).filter(Boolean) : null;
    if (options === null) throw fail(400, "Give at most 12 options");
    return { name, label: text(f.label, 60, "A field's label") || name.replace(/_/g, " "), ...(options?.length && { options }), ...(f.default !== undefined && { default: text(String(f.default), 200, "A default") }) };
  });
  if (new Set(fields.map((f) => f.name)).size !== fields.length) throw fail(400, "Each field needs its own name");
  return fields;
}

/** When an action runs by itself, checked, with its next time; null for never. */
export function scheduleOf(input, zone, now = Date.now()) {
  if (input === null) return null;
  if (typeof input !== "object") throw fail(400, "The schedule is not valid");
  const { every } = input;
  if (!EVERY.includes(every)) throw fail(400, "Choose how often: once, every few minutes, every hour, every day, weekdays or every week");
  let times = Array.isArray(input.times) ? [...new Set(input.times)].sort() : every === "hour" ? ["00:00"] : [];
  let date = input.date === "today" || input.date === "tomorrow" ? dateIn(now, zone, input.date === "tomorrow" ? 1 : 0) : input.date;
  let at;
  if (every === "once" && input.in_minutes !== undefined) {
    const minutes = Math.floor(Number(input.in_minutes));
    if (!(minutes >= 1 && minutes <= MAX_IN_MINUTES)) throw fail(400, `Give in_minutes from 1 to ${MAX_IN_MINUTES}`);
    at = Math.floor((now + minutes * 60_000) / 60_000) * 60_000;
    date = dateIn(at, zone);
    times = [timeIn(at, zone)];
  }
  const minutes = every === "minutes" ? Number(input.minutes) : undefined;
  if (every === "minutes") {
    if (!MINUTES.includes(minutes)) throw fail(400, `Choose every ${MINUTES.join(", ")} minutes`);
  } else if (!times.length || times.length > MAX_TIMES || !times.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw fail(400, `Give 1 to ${MAX_TIMES} times as HH:MM, for example 08:00`);
  const day = every === "week" ? (typeof input.day === "number" ? input.day : DAYS.indexOf(String(input.day ?? "").slice(0, 3).toLowerCase())) : undefined;
  if (every === "week" && !(day >= 0 && day <= 6)) throw fail(400, "Choose the day of the week");
  if (every === "once" && !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw fail(400, "Give the date as YYYY-MM-DD, today, tomorrow, or in_minutes");
  const plan = { every, times: every === "minutes" ? [] : every === "hour" || every === "once" ? times.slice(0, 1) : times, ...(every === "week" && { day }), ...(every === "once" && { date }), ...(every === "minutes" && { minutes }), timezone: zone };
  return { ...plan, nextRunAt: at ?? nextRun(plan, zone, now) };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** A schedule in a few plain words: "every day at 08:00". */
export const when = (s) =>
  s.every === "minutes" ? `every ${s.minutes} minutes` : s.every === "hour" ? `every hour at :${s.times[0].slice(3)}` : s.every === "once" ? `once, on ${s.date} at ${s.times[0]}` : `${s.every === "weekday" ? "on weekdays" : s.every === "week" ? `every ${DAY_NAMES[s.day]}` : "every day"} at ${s.times.join(" and ")}`;

/** The action as it would be saved: input over what is there, checked. */
export function planAction(input, current = {}, isolated = false, zone = "UTC") {
  const next = {
    title: text(input.title, MAX_ACTION_TITLE, "The title") ?? current.title,
    about: text(input.about, MAX_ACTION_ABOUT, "about") ?? current.about ?? "",
    kind: input.kind ?? current.kind,
    request: text(input.request, MAX_ACTION_REQUEST, "The request") ?? current.request ?? "",
    script: input.script === undefined ? (current.script ?? "") : typeof input.script === "string" ? input.script : null,
    fields: fieldsOf(input.fields) ?? current.fields ?? [],
    icon: input.icon ?? current.icon ?? "bolt",
    schedule: input.schedule === undefined ? (current.schedule ?? null) : scheduleOf(input.schedule, zone),
  };
  if (!next.title) throw fail(400, "Give the action a short title");
  if (!KINDS.includes(next.kind)) throw fail(400, 'Choose the kind: "agent" (a request to you) or "script" (code that runs without you)');
  if (!ICONS.includes(next.icon)) next.icon = "bolt";
  if (next.script === null) throw fail(400, "The script must be text");
  if (next.kind === "agent") {
    if (!next.request) throw fail(400, "Give the request: the message you get when the user taps it");
    const unknown = [...next.request.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map((m) => m[1]).filter((name) => !next.fields.some((f) => f.name === name));
    if (unknown.length) throw fail(400, `The request uses {${unknown[0]}}, but no field has that name`);
    next.script = "";
  } else {
    if (isolated) throw fail(400, "An isolated agent can save only agent actions");
    if (!next.script.trim()) throw fail(400, "Give the script");
    if (next.script.length > MAX_ACTION_SCRIPT) throw fail(400, `The script is too long: ${MAX_ACTION_SCRIPT} characters at most`);
    if (!/export\s+default/.test(next.script)) throw fail(400, "The script must export a default async function: export default async function ({ input, browser }) { … }");
    next.request = "";
  }
  if (next.schedule && next.fields.some((f) => !f.default)) throw fail(400, "An action that runs by itself needs a default for each field");
  return next;
}

/** The values for an action's fields: what was given, else each field's default. */
export function valuesOf(action, input = {}) {
  const values = {};
  for (const f of action.fields) {
    const given = input?.[f.name];
    const value = typeof given === "string" || typeof given === "number" ? String(given).trim() : (f.default ?? "");
    if (!value) throw fail(400, `Fill in ${f.label}`);
    if (f.options && !f.options.includes(value)) throw fail(400, `Choose one of the options for ${f.label}`);
    values[f.name] = value.slice(0, 500);
  }
  return values;
}

export const filled = (request, values) => request.replace(/\{([a-z][a-z0-9_]*)\}/g, (all, name) => values[name] ?? all);

/** What a script returned, as text for the user: a string as it is, an object as one "name: value" line each ("stop" and "pin" left out). */
export function shown(result) {
  const out = typeof result === "string" ? result : result && typeof result === "object" ? Object.entries(result).filter(([k]) => k !== "stop" && k !== "pin").map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n") : result === undefined ? "Done." : JSON.stringify(result);
  return out.length > ACTION_SHOWN ? `${out.slice(0, ACTION_SHOWN)}…` : out;
}

// Runs that waited for the user, from an older version, are left out.
const view = ({ id, title, about, kind, request, fields, icon, schedule, runs }) => ({ id, title, about, kind, request, fields, icon, schedule: schedule ?? null, runs: (runs ?? []).filter((r) => !r.waiting) });

const find = (agentId, id) => {
  const action = state.items.find((a) => a.id === id && a.agentId === agentId);
  if (!action) throw fail(404, "This action does not exist");
  return action;
};

const record = (action, run) => (action.runs = [run, ...(action.runs ?? []).filter((r) => !r.waiting)].slice(0, MAX_ACTION_RUNS));

export async function listActions(agentId) {
  await load();
  return state.items.filter((a) => a.agentId === agentId).map(view);
}

export async function removeAction(agentId, id) {
  await load();
  find(agentId, id);
  state.items = state.items.filter((a) => a.id !== id);
  await save();
  await unlinkPins(id);
}

export async function forgetActions(agentId) {
  await load();
  state.items = state.items.filter((a) => a.agentId !== agentId);
  await save();
}

/** The user makes an action themselves: a request to the agent, theirs, so no approval. */
export async function addAction(agentId, { title, request }) {
  await load();
  if (state.items.filter((a) => a.agentId === agentId).length >= MAX_ACTIONS) throw fail(400, `An agent can have ${MAX_ACTIONS} actions`);
  const plan = planAction({ title, request, kind: "agent", icon: "bolt" }, {}, isIsolated(await getAgent(agentId)), state.timezone);
  const action = { id: randomUUID(), agentId, ...plan, runs: [] };
  state.items.push(action);
  await save();
  return view(action);
}

/** The user renames an action, changes what it asks for, or when it runs by itself: theirs to decide, so no approval. */
export async function changeAction(agentId, id, { title, request, schedule }) {
  await load();
  const action = find(agentId, id);
  if (request !== undefined && action.kind === "script") throw fail(400, `Ask the agent to change how "${action.title}" works`);
  if (title !== undefined || request !== undefined) Object.assign(action, planAction({ title, request }, action, false, state.timezone));
  if (schedule !== undefined) {
    const next = scheduleOf(schedule, state.timezone);
    if (next && action.fields.some((f) => !f.default)) throw fail(400, "Tell the agent the usual values for this action first: it runs by itself only with them.");
    action.schedule = next;
  }
  await save();
  return view(action);
}

// Runs a script as the agent's own user, with a key that reaches only its browser. Its last line on
// stdout is the answer (run.mjs writes it); anything longer than MAX_ACTION_OUTPUT is cut.
export async function runScript(agent, script, input) {
  if (isIsolated(agent)) throw fail(400, "An isolated agent cannot run scripts here");
  const key = scriptKey(agent.id);
  const started = Date.now();
  try {
    const answer = await new Promise((resolve) => {
      const env = { ...passedOn(), ...sharedTools, HOME: userHomeOf(agent), WEILO_AGENT: agent.id, WEILO_API: `http://127.0.0.1:${PORT}/api`, WEILO_KEY: key };
      const child = spawnAs(userOf(agent), process.execPath, [RUNNER], { cwd: homeOf(agent), env, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => (child.kill("SIGKILL"), resolve({ ok: false, error: `It took longer than ${ACTION_MS / 1000} seconds and was stopped.` })), ACTION_MS);
      child.stdout.setEncoding("utf8").on("data", (chunk) => out.length < MAX_ACTION_OUTPUT && (out += chunk));
      child.stderr.setEncoding("utf8").on("data", (chunk) => (err = (err + chunk).slice(-2000)));
      child.on("error", (e) => (clearTimeout(timer), resolve({ ok: false, error: e.message })));
      child.on("close", (code) => {
        clearTimeout(timer);
        const line = out.trim().split("\n").at(-1) ?? "";
        try {
          resolve(JSON.parse(line));
        } catch {
          resolve({ ok: false, error: err.trim().split("\n").at(-1) || `The script stopped (${code}) without an answer.` });
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify({ script, input }));
    });
    const ok = answer.ok === true;
    return { ok, text: ok ? shown(answer.result) : `Failed: ${String(answer.error ?? "no answer").slice(0, 500)}`, ms: Date.now() - started, stop: ok && answer.result?.stop === true, pin: ok ? answer.result?.pin : undefined };
  } finally {
    dropScriptKey(key);
  }
}

const running = new Set();

async function runSaved(agentId, action, values, by) {
  if (running.has(action.id)) throw fail(409, `${action.title} is already running`);
  running.add(action.id);
  try {
    const result = await runScript(await getAgent(agentId), action.script, values);
    // A script may say it is done ({ stop: true }), like a delivery that arrived: then it stops running by itself.
    const stopped = result.stop && action.schedule ? ((action.schedule = null), "\nStopped running by itself.") : "";
    // A script that keeps pins fresh returns { pin: {…} }; by itself, only a change is worth a notification.
    const pinned = (await pinsOf(action.id)).length > 0;
    const moved = pinned && result.pin ? await updateFromAction(agentId, action.id, result.pin) : [];
    const said = result.text || (result.pin ? moved.map(pinLine).join("\n") || "No change." : "Done.");
    const run = { at: Date.now(), ok: result.ok, text: `${said}${stopped}`, by, ms: result.ms };
    record(action, run);
    if (state.items.includes(action)) await save();
    audit("action run", { agent: agentId, action: action.title, ok: result.ok, by });
    return { ...run, quiet: pinned && result.ok && !moved.length };
  } finally {
    running.delete(action.id);
  }
}

/** An action runs: an agent action goes to the agent as a message, a script runs here. by: "you" or "schedule". */
export async function runAction(agentId, id, input, by = "you") {
  await load();
  const action = find(agentId, id);
  const values = valuesOf(action, input);
  if (action.kind === "agent") {
    const away = by === "schedule";
    const pins = await pinsOf(action.id);
    const notes = [away && AWAY_NOTE, filled(action.request, values), CONFIRM_NOTE, pins.length && `${PIN_NOTE}${pins.map((p) => p.id).join(", ")}.`].filter(Boolean).join("\n\n");
    await prompt(agentId, { text: `${ACTION_MARK}${action.title}${away ? BY_ITSELF : ""}\n\n${notes}` });
    record(action, { at: Date.now(), ok: true, text: `Asked ${(await getAgent(agentId)).name}`, by, chat: true });
    await save();
    return { sent: true };
  }
  return runSaved(agentId, action, values, by);
}

// A due action runs as if tapped, with its fields' defaults. An agent action asks with its own ask (which notifies).
async function runDue(action) {
  const agent = await getAgent(action.agentId);
  const result = await runAction(action.agentId, action.id, {}, "schedule");
  if ("text" in result && !result.quiet) void notify(agent, result.ok ? "reply" : "error", `${action.title}: ${result.text}`).catch(() => {});
}

let ticking = false;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await load();
    const now = Date.now();
    const due = state.items.filter((a) => a.schedule?.nextRunAt != null && a.schedule.nextRunAt <= now);
    const runs = [];
    for (const action of due) {
      const late = now - action.schedule.nextRunAt > LATE_MS;
      // The next time is saved before the run starts: a crash skips a run, never repeats one.
      if (action.schedule.every === "once") action.schedule = null;
      else {
        try {
          action.schedule.nextRunAt = nextRun(action.schedule, action.schedule.timezone, now);
        } catch {
          action.schedule.nextRunAt = null;
        }
      }
      if (late) record(action, { at: now, ok: false, text: MISSED, by: "schedule" });
      else runs.push(action);
    }
    if (due.length) await save();
    for (const action of runs)
      void runDue(action)
        .catch(async (err) => {
          record(action, { at: Date.now(), ok: false, text: `Failed: ${String(err.message).slice(0, 300)}`, by: "schedule" });
          await save();
        })
        .finally(() => tellChats(action.agentId, { type: "actions_changed" }));
    for (const action of due) if (!runs.includes(action)) tellChats(action.agentId, { type: "actions_changed" });
  } catch (err) {
    console.error("actions:", err);
  } finally {
    ticking = false;
  }
}

export function startActions() {
  setInterval(() => void tick(), ACTIONS_EVERY_MS).unref();
  void tick();
}

const describe = (a) =>
  `${a.id}: "${a.title}" (${a.kind}${a.schedule ? `, runs by itself ${when(a.schedule)}` : ""})${a.about ? ` ${a.about}` : ""}${a.fields.length ? `. Fields: ${a.fields.map((f) => `${f.name}${f.options ? ` [${f.options.join(" | ")}]` : ""}${f.default ? ` = ${f.default}` : ""}`).join(", ")}` : ""}${a.kind === "agent" ? `. Request: ${a.request}` : `. Script:\n${a.script}`}${a.runs?.[0] ? `\nLast run: ${a.runs[0].ok ? "ok" : "failed"}, ${a.runs[0].text}` : ""}`;

// What the user sees to approve, in plain words; the request or script is there for anyone who wants to look.
function question(agentName, plan, changing) {
  const lines = [changing ? `${agentName} would like to change "${plan.title}".` : `${agentName} would like to add a button: "${plan.title}".`];
  if (plan.about) lines.push(plan.about);
  if (plan.schedule) lines.push(`It would also run by itself ${when(plan.schedule)}.`);
  if (plan.fields.length) lines.push(`It asks for: ${plan.fields.map((f) => f.label).join(", ")}.`);
  lines.push(plan.kind === "agent" ? `How it works: it asks ${agentName} to "${plan.request}".` : `How it works: a small program ${agentName} wrote runs in seconds, with ${agentName}'s browser and your sign-ins:\n\n${plan.script}`);
  return lines.join("\n\n");
}

/** The agent's action tool: list, try, create, update, delete and run. */
export async function actionTool(agentId, { op, id, input, ...fields }) {
  await load();
  const agent = await getAgent(agentId);
  if (op === "list") {
    const mine = state.items.filter((a) => a.agentId === agentId);
    return { text: mine.length ? mine.map(describe).join("\n\n") : "No actions yet." };
  }
  if (op === "try") {
    const plan = planAction({ title: "Try", ...fields, kind: "script", schedule: null }, {}, isIsolated(agent));
    const result = await runScript(agent, plan.script, valuesOf(plan, input));
    return { text: `${result.ok ? "It worked" : "It failed"} (${result.ms} ms):\n${result.text}${result.pin ? `\npin: ${JSON.stringify(result.pin)}` : ""}` };
  }
  if (op === "run") {
    const action = find(agentId, id);
    if (action.kind === "agent") return { text: "This action is a request to you: do it yourself." };
    const result = await runSaved(agentId, action, valuesOf(action, input), "you");
    tellChats(agentId, { type: "actions_changed" });
    return { text: result.text };
  }
  if (op === "delete") {
    const action = find(agentId, id);
    await removeAction(agentId, id);
    return { text: "Deleted.", details: { op, title: action.title } };
  }
  if (op !== "create" && op !== "update") throw fail(400, "Unknown op");
  const current = op === "update" ? find(agentId, id) : undefined;
  // Stopping an action from running by itself needs no approval: it only does less.
  if (current && fields.schedule === null && Object.keys(fields).every((k) => k === "schedule")) {
    current.schedule = null;
    await save();
    return { text: `"${current.title}" no longer runs by itself.`, details: { op, title: current.title } };
  }
  if (!current && state.items.filter((a) => a.agentId === agentId).length >= MAX_ACTIONS) throw fail(400, `An agent can have ${MAX_ACTIONS} actions`);
  const plan = planAction(fields, current, isIsolated(agent), state.timezone);
  const options = current ? ["Save the change", "No thanks"] : plan.schedule ? [`Add it, and run it ${when(plan.schedule)}`, "Add the button only", "No thanks"] : ["Add the button", "No thanks"];
  const answer = await askUser(agentId, question(agent.name, plan, !!current), options);
  if (!answer || answer === "No thanks") return { text: "The user did not want it: nothing was saved. Do not ask again unless they ask you to." };
  if (answer === "Add the button only") plan.schedule = null;
  if (current) {
    if (!state.items.includes(current)) throw fail(409, "The action was deleted meanwhile");
    Object.assign(current, plan);
  } else state.items.push({ id: randomUUID(), agentId, ...plan, runs: [] });
  await save();
  const scheduled = plan.schedule ? ` It runs by itself ${when(plan.schedule)}.` : "";
  return { text: `Saved. The user can tap "${plan.title}" in the app now.${scheduled}`, details: { op, title: plan.title } };
}
