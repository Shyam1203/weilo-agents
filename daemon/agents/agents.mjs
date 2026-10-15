import { randomBytes } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { BUNDLED, fail, HOMES, ORDER, PROFILES, readJson, RUN, SESSIONS, slug, updateJson, WORKSPACE } from "../common.mjs";
import { AGENTS_GID, FIRST_AGENT_UID } from "../config.mjs";
import { folder as ownFolder, setOwner, tree } from "../users.mjs";
import { extensionsOf } from "../settings/extensions.mjs";
import { lastMessage } from "./sessions.mjs";

// An agent is a folder: agent/profiles/<id>/agent.json { name, model, thinking, skills, plugins, extensions, disabled, instructions, avatar, folder }.
// `extensions`: the ids of the added extensions it uses; `disabled`: the ids of the bundled ones it does not use.
// Its one conversation is the pi session with the same id, in agent/sessions/<id>/.
// `folder`: its home in the shared workspace (workspace/<folder>/), where it works and its uploads go. Named after the agent
// when it is made, and kept when it is renamed, so paths in its chat still lead to their files.
// `uid`: the Linux user its pi runs as (users.mjs), given when it is made.

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

// Its pi reads the profile, as the agent's user: the file is root's, readable by that user's group.
async function save(id, agent) {
  await updateJson(profilePath(id), () => agent);
  await setOwner(profilePath(id), 0, agent.uid, 0o640);
}

// A user for a new agent: the next one after every agent's.
export const newUid = (taken) => Math.max(FIRST_AGENT_UID - 1, ...taken.filter(Number.isInteger)) + 1;

// A name for a new home folder: the agent's name, unless the workspace or another agent already has it.
export async function newFolder(name, taken = []) {
  const used = new Set([...(await readdir(WORKSPACE).catch(() => [])), ...taken]);
  const base = slug(name, 24) || "agent";
  let folder = base;
  for (let n = 2; used.has(folder); n++) folder = `${base}-${n}`;
  return folder;
}

// The agent's home folder in the workspace. A folder name is checked like an id, so a home is never the workspace itself
// or outside it.
export const homeOf = ({ folder }) => {
  if (typeof folder !== "string" || !isAgentId(folder)) throw fail(500, "This agent has no folder");
  return join(WORKSPACE, folder);
};
// Its HOME: its tools' own settings and sign-ins.
export const userHomeOf = (agent) => join(HOMES, homeOf(agent).slice(WORKSPACE.length + 1));

// The agent's folders, ready for use (the user may have removed one): its home in the workspace, shared with the group;
// its chat folder and HOME, its own.
export const makeHome = (agent) =>
  Promise.all([ownFolder(homeOf(agent), agent.uid, AGENTS_GID, 0o2770), ownFolder(join(SESSIONS, agent.id), agent.uid, agent.uid, 0o700), ownFolder(userHomeOf(agent), agent.uid, agent.uid, 0o700)]);

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

// The settings as they would be saved, or why they cannot be: for asking the user before making or changing an agent.
export async function checkAgent(input) {
  const agent = clean(input);
  await extensionsOf(agent);
  return agent;
}

export async function createAgent(input) {
  const agent = await checkAgent(input);
  const id = `${slug(agent.name, 24) || "agent"}-${randomBytes(3).toString("hex")}`;
  const others = await profiles();
  const made = { ...agent, folder: await newFolder(agent.name, others.map((a) => a.folder)), uid: newUid(others.map((a) => a.uid)) };
  await ownFolder(folder(id), 0, made.uid, 0o750);
  await save(id, made);
  await makeHome({ id, ...made });
  return getAgent(id);
}

export async function updateAgent(id, patch) {
  const saved = await getAgent(id);
  const agent = clean({ ...saved, ...patch });
  // Refused now, not when the agent starts: two of its extensions add the same tool.
  await extensionsOf(agent);
  await save(id, { ...agent, folder: saved.folder, uid: saved.uid });
  return getAgent(id);
}

export async function removeProfile(id) {
  await getAgent(id);
  await rm(folder(id), { recursive: true, force: true });
}

// What a deleted agent leaves: its HOME and pi settings go; its chat and its workspace folder go too, unless the user keeps
// them. What is kept is handed to root (the chat) and the group (the folder): a new agent may get the same user later.
export async function removeFiles(agent, { keepChat, keepFiles }) {
  const remove = (path) => rm(path, { recursive: true, force: true });
  await Promise.all([remove(userHomeOf(agent)), remove(join(RUN, "pi", agent.id))]);
  await (keepChat ? tree(join(SESSIONS, agent.id), 0, 0, "go-rwx") : remove(join(SESSIONS, agent.id)));
  await (keepFiles ? tree(homeOf(agent), 0, AGENTS_GID, "g+rwX,o-rwx") : remove(homeOf(agent)));
}

// Where the agent's profile is, for pi's command line: pi adds it to its system prompt.
export const profilePath = (id) => join(folder(id), "agent.json");
