import { getAgent, profiles } from "../agents/agents.mjs";
import { restartAll } from "../agents/runner.mjs";
import { ALLOWED_NOTE, approve } from "../agents/approve.mjs";
import { fail, readJson, SETTINGS, updateJson } from "../common.mjs";
import { MIN_RESERVE } from "../config.mjs";
import { getCurator } from "../memory/curator.mjs";
import { reserveFor } from "./compaction.mjs";
import { availableModels, setEnabledModels, syncCompaction } from "./providers.mjs";

const FIELDS = ["enable", "disable", "compaction"];
const APPROVE = "Change it";

const names = (value) => value === undefined || (Array.isArray(value) && value.every((v) => typeof v === "string"));
const list = (items) => items.join(", ");

function planSettings(request, { enabled, models, users, overrides }) {
  const other = Object.keys(request).find((f) => !FIELDS.includes(f));
  if (other) throw fail(400, `Only enable, disable and compaction can be changed, not ${other}.`);
  const { enable = [], disable = [], compaction = {} } = request;
  if (!names(enable) || !names(disable) || typeof compaction !== "object" || compaction === null || Array.isArray(compaction)) throw fail(400, "The request is not valid.");
  const byId = new Map(models.map((m) => [`${m.provider}/${m.id}`, m]));
  const unknown = [...enable, ...Object.keys(compaction)].filter((id) => !byId.has(id));
  if (unknown.length) throw fail(400, `${list(unknown)}: not a model of a provider with a key or sign-in. Only those can be used.`);
  const lines = [];
  const before = enabled.length ? enabled : [...byId.keys()];
  const off = disable.filter((id) => before.includes(id));
  const breaks = off.filter((id) => users[id]?.length).map((id) => `${id} (used by ${list(users[id])})`);
  if (breaks.length) throw fail(409, `Cannot turn off ${list(breaks)}: change their model first.`);
  const next = [...new Set([...before.filter((id) => !off.includes(id)), ...enable])];
  if (!next.length) throw fail(409, "At least one model must stay on.");
  const on = next.filter((id) => !before.includes(id));
  if (on.length) lines.push(`Turn on the models ${list(on)}`);
  if (off.length) lines.push(`Turn off the models ${list(off)}`);
  const plan = {};
  for (const [id, tokens] of Object.entries(compaction)) {
    const { contextWindow: window } = byId.get(id);
    const now = overrides[id]?.reserveTokens;
    if (tokens === null) {
      lines.push(`Summarize ${id}'s conversations when the app chooses (now ${now ?? "the app's choice"})`);
    } else {
      if (!window) throw fail(400, `${id}: its context window is not known, so it is summarized when pi chooses.`);
      if (!Number.isInteger(tokens) || tokens < MIN_RESERVE || tokens >= window) throw fail(400, `${id}: keep between ${MIN_RESERVE} and ${window - 1} tokens free (its window is ${window}).`);
      const used = Math.round((100 * (window - tokens)) / window);
      lines.push(`Summarize ${id}'s conversations when ${tokens} of its ${window} tokens are left free, at ${used}% (now ${now ?? reserveFor(window)} free)`);
    }
    plan[id] = tokens;
  }
  if (!lines.length) throw fail(400, "Nothing would change.");
  return { enabledModels: on.length || off.length ? next : undefined, compaction: plan, lines };
}

async function current() {
  const [settings, models, agents, curator] = await Promise.all([readJson(SETTINGS), availableModels(), profiles(), getCurator()]);
  const users = {};
  for (const { name, model } of agents) (users[model] ??= []).push(name);
  if (curator.model) (users[curator.model] ??= []).push("the memory curator");
  return { enabled: settings.enabledModels ?? [], models, users, overrides: settings.compaction?.modelOverrides ?? {} };
}

export async function manageSettings(id, { action, ...request }) {
  const now = await current();
  if (action === "list") {
    const on = (key) => !now.enabled.length || now.enabled.includes(key);
    return {
      text: [
        "Models (provider/id: on or off; context window; tokens kept free before a summary):",
        ...now.models.map(({ provider, id: model, contextWindow }) => {
          const key = `${provider}/${model}`;
          return `- ${key}: ${on(key) ? "on" : "off"}; ${contextWindow ?? "unknown"}; ${now.overrides[key]?.reserveTokens ?? "the app's choice"}${now.users[key] ? `; used by ${list(now.users[key])}` : ""}`;
        }),
      ].join("\n"),
    };
  }
  if (action !== "change") throw fail(400, "Use list or change.");
  const plan = planSettings(request, now);
  const question = `${(await getAgent(id)).name} asks to change the app's settings:\n${plan.lines.join("\n")}`;
  const { answer, always } = await approve(id, "settings", question, [APPROVE, "Don't"]);
  if (answer !== APPROVE) return { text: "The user did not approve it: nothing was changed." };
  const fresh = planSettings(request, await current());
  const effect = (p) => JSON.stringify([[...(p.enabledModels ?? [])].sort(), p.compaction]);
  if (effect(fresh) !== effect(plan)) throw fail(409, "The settings were changed while the user was asked. Look again, and ask again if it is still needed.");
  if (Object.keys(plan.compaction).length) {
    await updateJson(SETTINGS, (settings) => {
      const modelOverrides = { ...settings.compaction?.modelOverrides };
      for (const [model, tokens] of Object.entries(plan.compaction)) {
        if (tokens === null) delete modelOverrides[model];
        else modelOverrides[model] = { ...modelOverrides[model], reserveTokens: tokens };
      }
      return { ...settings, compaction: { ...settings.compaction, modelOverrides } };
    });
  }
  await (plan.enabledModels ? setEnabledModels(plan.enabledModels) : syncCompaction());
  await restartAll();
  const text = "Changed. Agents start anew with it (you after this reply).";
  return always ? { text, details: { note: `Changed the model settings${ALLOWED_NOTE}` } } : { text };
}
