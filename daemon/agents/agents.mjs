import { randomBytes } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { BUNDLED, fail, ORDER, PROFILES, readJson, SESSIONS, slug, updateJson } from "../common.mjs";
import { extensionsOf } from "../settings/extensions.mjs";
import { lastMessage } from "./sessions.mjs";

// An agent is a folder: agent/profiles/<id>/agent.json { name, model, thinking, skills, plugins, extensions, disabled, instructions, avatar }.
// `extensions`: the ids of the added extensions it uses; `disabled`: the ids of the bundled ones it does not use.
// Its one conversation is the pi session with the same id, in agent/sessions/<id>/.

// Ids are made here; checking them keeps every path inside the agents folder.
export const isAgentId = (id) => /^[a-z0-9-]+$/.test(id);
const folder = (id) => {
  if (!isAgentId(id)) throw fail(404, "This agent does not exist");
  return join(PROFILES, id);
};

// Pi's thinking levels; empty leaves it to the model.
const THINKING = ["", "off", "minimal", "low", "medium", "high", "xhigh", "max"];

const ids = (list) => Array.isArray(list) && list.every((id) => typeof id === "string");

const clean = ({ name, model, thinking = "", skills = [], plugins = [], extensions = [], disabled = [], instructions = "", avatar }) => {
  if (typeof name !== "string" || !name.trim()) throw fail(400, "Type a name");
  if (typeof model !== "string" || !model.trim()) throw fail(400, "Choose a model");
  if (typeof instructions !== "string" || !THINKING.includes(thinking) || !ids(skills) || !ids(plugins) || !ids(extensions) || !ids(disabled)) throw fail(400, "The agent settings are not valid");
  const { shape, color } = avatar ?? {};
  return { name: name.trim(), model: model.trim(), thinking, skills, plugins, extensions, disabled, instructions, ...(typeof shape === "string" && typeof color === "string" && { avatar: { shape, color } }) };
};

const save = (id, agent) => updateJson(profilePath(id), () => agent);

// A switched-off extension that is not bundled any more is dropped when read.
export async function getAgent(id) {
  try {
    const saved = JSON.parse(await readFile(profilePath(id), "utf8"));
    const agent = { id, thinking: "", skills: [], plugins: [], extensions: [], disabled: [], instructions: "", ...saved };
    return { ...agent, disabled: Array.isArray(agent.disabled) ? agent.disabled.filter((name) => Object.hasOwn(BUNDLED, name)) : [] };
  } catch (err) {
    throw err.code === "ENOENT" ? fail(404, "This agent does not exist") : err;
  }
}

// Every agent's profile; one that cannot be read is left out.
export async function profiles() {
  const ids = await readdir(PROFILES).catch(() => []);
  return (await Promise.all(ids.map((id) => getAgent(id).catch(() => null)))).filter(Boolean);
}

// The profiles with the newest message of each chat, for the agent list, in the order the user dragged them to
// (order.json { agents: [ids] }). Agents not in it (made since) come after, in folder order.
export async function listAgents() {
  const { agents } = await readJson(ORDER);
  const order = Array.isArray(agents) ? agents : [];
  const place = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
  const sorted = (await profiles()).sort((a, b) => place(a.id) - place(b.id));
  return Promise.all(sorted.map(async (agent) => ({ ...agent, last: await lastMessage(agent.id) })));
}

export async function setOrder(order) {
  if (!ids(order)) throw fail(400, "The order is not valid");
  await updateJson(ORDER, (data) => ({ ...data, agents: order.filter(isAgentId) }));
}

export async function createAgent(input) {
  const agent = clean(input);
  await extensionsOf(agent);
  const id = `${slug(agent.name, 24) || "agent"}-${randomBytes(3).toString("hex")}`;
  await save(id, agent);
  return getAgent(id);
}

export async function updateAgent(id, patch) {
  const agent = clean({ ...(await getAgent(id)), ...patch });
  // Refused now, not when the agent starts: two of its extensions add the same tool.
  await extensionsOf(agent);
  await save(id, agent);
  return getAgent(id);
}

export async function removeProfile(id) {
  await getAgent(id);
  await rm(folder(id), { recursive: true, force: true });
}

export const removeChat = (id) => rm(join(SESSIONS, id), { recursive: true, force: true });

// Where the agent's profile is, for pi's command line: pi adds it to its system prompt.
export const profilePath = (id) => join(folder(id), "agent.json");
