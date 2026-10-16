import { randomUUID } from "node:crypto";
import { audit } from "../audit.mjs";
import { fail, PINS, readJson, updateJson } from "../common.mjs";
import { MAX_PIN_HISTORY, MAX_PIN_ITEMS, MAX_PINS } from "../config.mjs";
import { tellChats } from "../agents/runner.mjs";
import { ICONS, listActions } from "./actions.mjs";

// Pins: small cards the agent keeps up to date for the user (a price, an order, a list), on the
// Pins tab of the app's actions panel. They only show things, so they need no approval.
export const PIN_KINDS = ["status", "list"];
const TONES = ["good", "bad"];

let state;
let loading;
const load = () => (loading ??= readJson(PINS).then((data) => (state = { items: Array.isArray(data.items) ? data.items : [] })));
const save = () => updateJson(PINS, () => state);

const text = (value, max, what) => {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw fail(400, `${what} must be text`);
  if (value.trim().length > max) throw fail(400, `${what} is too long: ${max} characters at most`);
  return value.trim();
};

/** The number in a value like "$1,299.99", for the little chart. */
export const numberIn = (value) => {
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(value ?? "");
  return m ? Number(m[0].replaceAll(",", "")) : null;
};

function stepsOf(steps) {
  if (steps === undefined || steps === null) return steps;
  const done = Number(steps.done);
  const total = Number(steps.total);
  if (!Number.isInteger(done) || !Number.isInteger(total) || total < 1 || total > 10 || done < 0 || done > total) throw fail(400, "steps: done and total, whole numbers, total 1 to 10");
  return { done, total };
}

function itemsOf(items) {
  if (items === undefined) return undefined;
  if (!Array.isArray(items)) throw fail(400, "items must be a list");
  if (items.length > MAX_PIN_ITEMS) throw fail(400, `A list holds ${MAX_PIN_ITEMS} items at most`);
  return items.map((i) => {
    const item = typeof i === "string" ? { text: i } : i;
    const t = text(item?.text, 100, "An item");
    if (!t) throw fail(400, "Each item needs text");
    return { text: t, done: item.done === true };
  });
}

/** What changes, checked: title, icon, source, value, detail, tone, steps, items. */
export function pinChange(input) {
  const change = {
    title: text(input.title, 60, "The title"),
    source: text(input.source, 30, "source"),
    value: text(input.value, 40, "value"),
    detail: text(input.detail, 120, "detail"),
    steps: stepsOf(input.steps),
    items: itemsOf(input.items),
  };
  if (input.icon !== undefined) change.icon = ICONS.includes(input.icon) ? input.icon : "bolt";
  if (input.tone !== undefined) change.tone = TONES.includes(input.tone) ? input.tone : null;
  return Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined));
}

// Applies a change; says whether what the user sees of it changed (not just the time).
function apply(pin, change) {
  const before = JSON.stringify([pin.value, pin.detail, pin.steps, pin.items, pin.tone]);
  Object.assign(pin, change);
  if (change.value !== undefined) {
    const n = numberIn(change.value);
    if (n !== null && n !== (pin.history ?? []).at(-1)) pin.history = [...(pin.history ?? []), n].slice(-MAX_PIN_HISTORY);
  }
  pin.updatedAt = Date.now();
  const changed = JSON.stringify([pin.value, pin.detail, pin.steps, pin.items, pin.tone]) !== before;
  if (changed) pin.changedAt = pin.updatedAt;
  return changed;
}

const view = ({ agentId, ...pin }) => pin;

const find = (agentId, id) => {
  const pin = state.items.find((p) => p.id === id && p.agentId === agentId);
  if (!pin) throw fail(404, "This pin does not exist");
  return pin;
};

const changed = (agentId) => tellChats(agentId, { type: "pins_changed" });

export async function listPins(agentId) {
  await load();
  return state.items.filter((p) => p.agentId === agentId).map(view);
}

export async function removePin(agentId, id) {
  await load();
  find(agentId, id);
  state.items = state.items.filter((p) => p.id !== id);
  await save();
  changed(agentId);
}

/** The user ticks an item on a list, or unticks it. */
export async function tickPin(agentId, id, { index, done }) {
  await load();
  const pin = find(agentId, id);
  const item = pin.items?.[index];
  if (!item) throw fail(404, "This item is not on the list");
  item.done = done === true;
  pin.updatedAt = Date.now();
  await save();
  return view(pin);
}

export async function forgetPins(agentId) {
  await load();
  state.items = state.items.filter((p) => p.agentId !== agentId);
  await save();
}

/** An action was deleted: its pins stay, no longer kept fresh by it. */
export async function unlinkPins(actionId) {
  await load();
  const linked = state.items.filter((p) => p.actionId === actionId);
  if (!linked.length) return;
  for (const p of linked) p.actionId = null;
  await save();
}

/** The pins an action keeps fresh. */
export async function pinsOf(actionId) {
  await load();
  return state.items.filter((p) => p.actionId === actionId);
}

/** A script action returned { pin: {…} }: its pins take it. Returns the ones whose content changed. */
export async function updateFromAction(agentId, actionId, input) {
  await load();
  const linked = state.items.filter((p) => p.actionId === actionId && p.agentId === agentId);
  if (!linked.length || !input || typeof input !== "object") return [];
  const change = pinChange({ ...input, title: undefined });
  const moved = linked.filter((p) => apply(p, change));
  await save();
  changed(agentId);
  return moved.map(view);
}

/** A pin in one line, for a notification: "AirPods Pro: $189, ↓ $30 since Monday". */
export const pinLine = (p) => `${p.title}: ${p.value || (p.items ? `${p.items.filter((i) => !i.done).length} left` : "updated")}${p.detail ? `, ${p.detail}` : ""}`;

const describe = (p) =>
  `${p.id}: "${p.title}" (${p.kind}${p.actionId ? `, kept fresh by action ${p.actionId}` : ""})${p.source ? ` from ${p.source}` : ""}${p.value ? `: ${p.value}` : ""}${p.detail ? `, ${p.detail}` : ""}${p.steps ? `, step ${p.steps.done} of ${p.steps.total}` : ""}${p.items?.length ? `\n${p.items.map((i, n) => `${n}. [${i.done ? "x" : " "}] ${i.text}`).join("\n")}` : ""}`;

/** The agent's pin tool: list, pin, update and unpin. */
export async function pinTool(agentId, { op, id, action: linked, kind, ...fields }) {
  await load();
  const action = linked === "" ? null : linked;
  if (op === "list") {
    const mine = state.items.filter((p) => p.agentId === agentId);
    return { text: mine.length ? mine.map(describe).join("\n\n") : "No pins yet." };
  }
  if (op === "unpin") {
    const pin = find(agentId, id);
    await removePin(agentId, id);
    return { text: "Unpinned.", details: { op, title: pin.title } };
  }
  if (op !== "pin" && op !== "update") throw fail(400, "Unknown op");
  if (action !== undefined && action !== null && !(await listActions(agentId)).some((a) => a.id === action)) throw fail(400, "No action has that id: see action list");
  const change = pinChange(fields);
  if (op === "update") {
    const pin = find(agentId, id);
    if (action !== undefined) pin.actionId = action;
    apply(pin, change);
    await save();
    changed(agentId);
    return { text: "Updated.", details: { op, title: pin.title } };
  }
  if (state.items.filter((p) => p.agentId === agentId).length >= MAX_PINS) throw fail(400, `An agent can have ${MAX_PINS} pins: unpin one first`);
  if (!change.title) throw fail(400, "Give the pin a short title");
  const pinKind = kind ?? (change.items ? "list" : "status");
  if (!PIN_KINDS.includes(pinKind)) throw fail(400, 'kind is "status" or "list"');
  const now = Date.now();
  const pin = { id: randomUUID(), agentId, kind: pinKind, title: change.title, icon: "bolt", source: "", value: "", detail: "", tone: null, steps: null, items: pinKind === "list" ? [] : undefined, history: [], actionId: action ?? null, at: now, updatedAt: now, changedAt: now };
  apply(pin, change);
  pin.changedAt = now;
  state.items.push(pin);
  await save();
  audit("pin", { agent: agentId, pin: pin.title });
  changed(agentId);
  return { text: `Pinned. The user sees "${pin.title}" on the Pins tab.`, details: { op, title: pin.title } };
}
