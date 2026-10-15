import { randomBytes } from "node:crypto";
import { access, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { APP, BUNDLED, fail, HOMES, ISOLATED, ISOLATED_SESSIONS, ORDER, PROFILES, readJson, RUN, SESSIONS, slug, updateJson, WORKSPACE } from "../common.mjs";
import { AGENTS_GID, FIRST_AGENT_UID, SHARED_TOOLS } from "../config.mjs";
import { folder as ownFolder, setOwner, tree } from "../users.mjs";
import { extensionsOf } from "../settings/extensions.mjs";
import { lastMessage } from "./sessions.mjs";

// An agent is a folder: agent/profiles/<id>/agent.json { name, model, thinking, skills, plugins, extensions, disabled, instructions, avatar, isolated, trusted, folder }.
// `extensions`: the ids of the added extensions it uses; `disabled`: the ids of the bundled ones it does not use.
// Its one conversation is the pi session with the same id, in agent/sessions/<id>/.
// `folder`: its home in the shared workspace (workspace/<folder>/), where it works and its uploads go. Named after the agent
// when it is made, and kept when it is renamed, so paths in its chat still lead to their files.
// `uid`: the Linux user its pi runs as (users.mjs), given when it is made.
// `isolated`: it has only its own folder (isolated/<folder>/, its chat in isolated-sessions/<id>/): not the workspace, the
// skill library, memory or the app's settings; the daemon gives it copies of what it uses (pidir.mjs) and refuses it the
// tools of what all agents share (`mayCall`). The other agents may read and change its folder, and search its chat.
// `trusted`: the changes it asks for to itself that are safe (agents/manage.mjs) apply without asking the user.
// Only the user sets either, in the app: no agent's request does (agents/manage.mjs).

// Ids are made here; checking them keeps every path inside the agents folder.
export const isAgentId = (id) => /^[a-z0-9-]+$/.test(id);
const folder = (id) => {
  if (!isAgentId(id)) throw fail(404, "This agent does not exist");
  return join(PROFILES, id);
};

// Pi's thinking levels; empty leaves it to the model.
const THINKING = ["", "off", "minimal", "low", "medium", "high", "xhigh", "max"];

const ids = (list) => Array.isArray(list) && list.every((id) => typeof id === "string");

const clean = ({ name, model, thinking = "", skills = [], plugins = [], extensions = [], disabled = [], instructions = "", avatar, isolated = false, trusted = false }) => {
  if (typeof name !== "string" || !name.trim()) throw fail(400, "Type a name");
  if (typeof model !== "string" || !model.trim()) throw fail(400, "Choose a model");
  if (typeof instructions !== "string" || !THINKING.includes(thinking) || !ids(skills) || !ids(plugins) || !ids(extensions) || !ids(disabled) || typeof isolated !== "boolean" || typeof trusted !== "boolean") throw fail(400, "The agent settings are not valid");
  const { shape, color } = avatar ?? {};
  return { name: name.trim(), model: model.trim(), thinking, skills, plugins, extensions, disabled, instructions, ...(typeof shape === "string" && typeof color === "string" && { avatar: { shape, color } }), isolated, trusted };
};

// Its pi reads the profile, as the agent's user: the file is root's, readable by that user's group. (An isolated agent's
// pi reads a copy: it cannot open agent/.)
async function save(id, agent) {
  await updateJson(profilePath(id), () => agent);
  await setOwner(profilePath(id), 0, agent.uid, 0o640);
}

// The one question every place that treats isolated agents apart asks.
export const isIsolated = (agent) => agent.isolated === true;

// Whether the agent may call this tool's routes (server.mjs): an isolated one has none of the tools of what all agents
// share, and the routes of a bundled extension (browser, routines) only while it has that extension on.
export const mayCall = (agent, tool) => !isIsolated(agent) || (!SHARED_TOOLS.includes(tool) && !(Object.hasOwn(BUNDLED, tool) && agent.disabled.includes(tool)));

// A user for a new agent: one no agent ever had, so a new agent never gets the files a deleted one left (in the workspace,
// the skills, the installed tools). weilo.json keeps the highest given (`lastUid`; migrate.mjs set it once from the files).
export const newUid = async () => (await updateJson(APP, (data) => ({ ...data, lastUid: Math.max(FIRST_AGENT_UID, (data.lastUid ?? 0) + 1) }))).lastUid;

// The Linux user an agent's pi (and an isolated agent's plugins) run as (users.mjs): an isolated agent's is in no group.
export const userOf = (agent) => ({ uid: agent.uid, gid: agent.uid, groups: isIsolated(agent) ? [] : [AGENTS_GID] });

// A name for a new home folder: the agent's name, unless the workspace, the isolated agents or another agent already has it.
export async function newFolder(name, taken = []) {
  const used = new Set([...(await readdir(WORKSPACE).catch(() => [])), ...(await readdir(ISOLATED).catch(() => [])), ...taken]);
  const base = slug(name, 24) || "agent";
  let folder = base;
  for (let n = 2; used.has(folder); n++) folder = `${base}-${n}`;
  return folder;
}

// The agent's home folder: in the workspace, or with the isolated agents'. A folder name is checked like an id, so a home is
// never the workspace itself or outside it.
export const homeOf = (agent) => {
  if (typeof agent.folder !== "string" || !isAgentId(agent.folder)) throw fail(500, "This agent has no folder");
  return join(isIsolated(agent) ? ISOLATED : WORKSPACE, agent.folder);
};
// Its chat's folder (pi's --session-dir).
export const chatDirOf = (agent) => join(isIsolated(agent) ? ISOLATED_SESSIONS : SESSIONS, agent.id);
// Its HOME: its tools' own settings and sign-ins.
export const userHomeOf = (agent) => join(HOMES, agent.folder);

// Where the files its chat names are looked for, in turn (the app's file preview, http/files.mjs), and what a file must be
// inside: from its home, and for a regular agent from the top of the workspace too; a regular agent's chat may show an
// isolated agent's files (it can read them), an isolated agent's only its own.
export const filesOf = (agent) => (isIsolated(agent) ? { folders: [homeOf(agent)], roots: [homeOf(agent)] } : { folders: [homeOf(agent), WORKSPACE], roots: [WORKSPACE, ISOLATED] });

// The agent's folders, ready for use (the user may have removed one): its home, shared with the group (an isolated agent is
// not in the group: it has its folder as its owner); its chat folder and HOME, its own.
export const makeHome = (agent) =>
  Promise.all([ownFolder(homeOf(agent), agent.uid, AGENTS_GID, 0o2770), ownFolder(chatDirOf(agent), agent.uid, agent.uid, 0o700), ownFolder(userHomeOf(agent), agent.uid, agent.uid, 0o700)]);

// An agent that becomes isolated, or regular again: its home and its chat move to the other kind's places. What is in its
// home becomes the agent's (shared with the group, as before): an isolated agent, not in the group, could not open what
// others made there. Its pi must not run meanwhile (runner.mjs `holding`). A folder of that name already there is not
// overwritten: the user renames one first.
async function move(before, after) {
  const pairs = [[homeOf(before), homeOf(after)], [chatDirOf(before), chatDirOf(after)]];
  for (const [, to] of pairs) {
    if (await access(to).then(() => true, () => false)) throw fail(409, `${to} already exists. Rename or remove it, then save again.`);
  }
  for (const [from, to] of pairs) await rename(from, to).catch((err) => err.code === "ENOENT" || Promise.reject(err));
  await tree(homeOf(after), after.uid, AGENTS_GID, "ug+rwX,o-rwx");
}

// An agent that becomes isolated starts without the browser (its logins are everyone's); the user may turn it on again.
const withoutBrowser = (agent, before) => (agent.isolated && !before?.isolated ? { ...agent, disabled: [...new Set([...agent.disabled, "browser"])] } : agent);

// A switched-off extension that is not bundled any more is dropped when read.
export async function getAgent(id) {
  try {
    const saved = JSON.parse(await readFile(profilePath(id), "utf8"));
    const agent = { id, thinking: "", skills: [], plugins: [], extensions: [], disabled: [], instructions: "", isolated: false, trusted: false, ...saved };
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
  const agent = withoutBrowser(await checkAgent(input));
  const id = `${slug(agent.name, 24) || "agent"}-${randomBytes(3).toString("hex")}`;
  const others = await profiles();
  const made = { ...agent, folder: await newFolder(agent.name, others.map((a) => a.folder)), uid: await newUid() };
  await ownFolder(folder(id), 0, made.uid, 0o750);
  await save(id, made);
  await makeHome({ id, ...made });
  return getAgent(id);
}

export async function updateAgent(id, patch) {
  const saved = await getAgent(id);
  const agent = withoutBrowser(clean({ ...saved, ...patch }), saved);
  // Refused now, not when the agent starts: two of its extensions add the same tool.
  await extensionsOf(agent);
  if (agent.isolated !== saved.isolated) await move(saved, { ...saved, isolated: agent.isolated });
  await save(id, { ...agent, folder: saved.folder, uid: saved.uid });
  return getAgent(id);
}

export async function removeProfile(id) {
  await getAgent(id);
  await rm(folder(id), { recursive: true, force: true });
}

// What a deleted agent leaves: its HOME and pi settings go; its chat and its workspace folder go too, unless the user keeps
// them. What is kept is handed to root (the chat) and the group (the folder). Its user is never given again (newUid), so
// files it left elsewhere are no new agent's.
export async function removeFiles(agent, { keepChat, keepFiles }) {
  const remove = (path) => rm(path, { recursive: true, force: true });
  await Promise.all([remove(userHomeOf(agent)), remove(join(RUN, "pi", agent.id))]);
  await (keepChat ? tree(chatDirOf(agent), 0, 0, "go-rwx") : remove(chatDirOf(agent)));
  await (keepFiles ? tree(homeOf(agent), 0, AGENTS_GID, "g+rwX,o-rwx") : remove(homeOf(agent)));
}

// Where the agent's profile is, for pi's command line: pi adds it to its system prompt.
export const profilePath = (id) => join(folder(id), "agent.json");
