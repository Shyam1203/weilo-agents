import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { audit } from "../audit.mjs";
import { ACTIONS, fail, readJson, updateJson } from "../common.mjs";
import { ACTION_MS, ACTION_SHOWN, MAX_ACTION_ABOUT, MAX_ACTION_FIELDS, MAX_ACTION_OUTPUT, MAX_ACTION_REQUEST, MAX_ACTION_SCRIPT, MAX_ACTION_TITLE, MAX_ACTIONS, PORT } from "../config.mjs";
import { dropScriptKey, scriptKey } from "../http/access.mjs";
import { getAgent, homeOf, isIsolated, userHomeOf, userOf } from "../agents/agents.mjs";
import { askUser, prompt } from "../agents/runner.mjs";
import { passedOn, sharedTools, spawnAs } from "../users.mjs";

export const KINDS = ["agent", "script"];
export const ICONS = ["bolt", "package", "food", "cart", "truck", "calendar", "mail", "money", "search", "globe"];
export const ACTION_MARK = "⚡ Action: ";
// The app's chat hides this line under an action's message; keep the two in step.
export const CONFIRM_NOTE = "Before you pay, order, book or send anything, use ask to confirm the exact details with the user.";
const SAVE = "Save it";
const RUNNER = fileURLToPath(new URL("./run.mjs", import.meta.url));

let state;
let loading;
const load = () =>
  (loading ??= readJson(ACTIONS).then(
    (saved) => (state = { items: Array.isArray(saved.items) ? saved.items : [] }),
    (err) => {
      loading = undefined;
      throw err;
    },
  ));
const save = () => updateJson(ACTIONS, () => state);

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

/** The action as it would be saved: input over what is there, checked. */
export function planAction(input, current = {}, isolated = false) {
  const next = {
    title: text(input.title, MAX_ACTION_TITLE, "The title") ?? current.title,
    about: text(input.about, MAX_ACTION_ABOUT, "about") ?? current.about ?? "",
    kind: input.kind ?? current.kind,
    request: text(input.request, MAX_ACTION_REQUEST, "The request") ?? current.request ?? "",
    script: input.script === undefined ? (current.script ?? "") : typeof input.script === "string" ? input.script : null,
    fields: fieldsOf(input.fields) ?? current.fields ?? [],
    confirm: typeof input.confirm === "boolean" ? input.confirm : (current.confirm ?? false),
    icon: input.icon ?? current.icon ?? "bolt",
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

/** What a script returned, as text for the user: a string as it is, an object as one "name: value" line each. */
export function shown(result) {
  const out = typeof result === "string" ? result : result && typeof result === "object" ? Object.entries(result).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n") : result === undefined ? "Done." : JSON.stringify(result);
  return out.length > ACTION_SHOWN ? `${out.slice(0, ACTION_SHOWN)}…` : out;
}

const view = ({ id, title, about, kind, request, fields, confirm, icon, last }) => ({ id, title, about, kind, request, fields, confirm, icon, last: last ?? null });

const find = (agentId, id) => {
  const action = state.items.find((a) => a.id === id && a.agentId === agentId);
  if (!action) throw fail(404, "This action does not exist");
  return action;
};

export async function listActions(agentId) {
  await load();
  return state.items.filter((a) => a.agentId === agentId).map(view);
}

export async function removeAction(agentId, id) {
  await load();
  find(agentId, id);
  state.items = state.items.filter((a) => a.id !== id);
  await save();
}

export async function forgetActions(agentId) {
  await load();
  state.items = state.items.filter((a) => a.agentId !== agentId);
  await save();
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
    return { ok: answer.ok === true, text: answer.ok === true ? shown(answer.result) : `Failed: ${String(answer.error ?? "no answer").slice(0, 500)}`, ms: Date.now() - started };
  } finally {
    dropScriptKey(key);
  }
}

const running = new Set();

/** The user tapped an action: an agent action goes to the agent as a message, a script runs here. */
export async function runAction(agentId, id, input) {
  await load();
  const action = find(agentId, id);
  const values = valuesOf(action, input);
  if (action.kind === "agent") {
    const request = filled(action.request, values);
    await prompt(agentId, { text: `${ACTION_MARK}${action.title}\n\n${request}${action.confirm ? `\n\n${CONFIRM_NOTE}` : ""}` });
    return { sent: true };
  }
  return runSaved(agentId, action, values);
}

async function runSaved(agentId, action, values) {
  if (running.has(action.id)) throw fail(409, `${action.title} is already running`);
  running.add(action.id);
  try {
    const result = await runScript(await getAgent(agentId), action.script, values);
    action.last = { at: Date.now(), ok: result.ok, text: result.text.slice(0, 300) };
    if (state.items.includes(action)) await save();
    audit("action run", { agent: agentId, action: action.title, ok: result.ok });
    return { ...result, at: action.last.at };
  } finally {
    running.delete(action.id);
  }
}

const describe = (a) =>
  `${a.id}: "${a.title}" (${a.kind}${a.confirm ? ", confirms first" : ""})${a.about ? ` ${a.about}` : ""}${a.fields.length ? `. Fields: ${a.fields.map((f) => `${f.name}${f.options ? ` [${f.options.join(" | ")}]` : ""}${f.default ? ` = ${f.default}` : ""}`).join(", ")}` : ""}${a.kind === "agent" ? `. Request: ${a.request}` : `. Script:\n${a.script}`}${a.last ? `\nLast run: ${a.last.ok ? "ok" : "failed"}, ${a.last.text}` : ""}`;

function question(agentName, plan, changing) {
  const fields = plan.fields.length ? `\n\nIt asks for: ${plan.fields.map((f) => f.label).join(", ")}.` : "";
  const confirm = plan.confirm ? (plan.kind === "script" ? "\n\nIt asks you to confirm each time before it runs." : "\n\nIt asks you to confirm before it pays, orders or sends anything.") : "";
  const body = plan.kind === "agent" ? `When you tap it, ${agentName} gets this request:\n\n${plan.request}` : `It runs this script, without the model (fast, no tokens), with the browser and your sign-ins:\n\n${plan.script}`;
  return `${agentName} asks to ${changing ? "change" : "save"} the action "${plan.title}"${plan.about ? `: ${plan.about}` : ""}.${fields}${confirm}\n\n${body}`;
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
    const plan = planAction({ title: "Try", ...fields, kind: "script" }, {}, isIsolated(agent));
    const result = await runScript(agent, plan.script, valuesOf(plan, input));
    return { text: `${result.ok ? "It worked" : "It failed"} (${result.ms} ms):\n${result.text}` };
  }
  if (op === "run") {
    const action = find(agentId, id);
    if (action.kind === "agent") return { text: "This action is a request to you: do it yourself." };
    return { text: (await runSaved(agentId, action, valuesOf(action, input))).text };
  }
  if (op === "delete") {
    const action = find(agentId, id);
    await removeAction(agentId, id);
    return { text: "Deleted.", details: { op, title: action.title } };
  }
  if (op !== "create" && op !== "update") throw fail(400, "Unknown op");
  const current = op === "update" ? find(agentId, id) : undefined;
  if (!current && state.items.filter((a) => a.agentId === agentId).length >= MAX_ACTIONS) throw fail(400, `An agent can have ${MAX_ACTIONS} actions`);
  const plan = planAction(fields, current, isIsolated(agent));
  if ((await askUser(agentId, question(agent.name, plan, !!current), [SAVE, "Don't"])) !== SAVE) return { text: "The user did not approve it: nothing was saved. Do not ask again unless they ask you to." };
  if (current) {
    if (!state.items.includes(current)) throw fail(409, "The action was deleted meanwhile");
    Object.assign(current, plan, { last: null });
  } else state.items.push({ id: randomUUID(), agentId, ...plan, last: null });
  await save();
  return { text: `Saved. The user can tap "${plan.title}" in the app now.`, details: { op, title: plan.title } };
}
