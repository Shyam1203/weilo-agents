import { randomBytes } from "node:crypto";
import { access, lstat, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { APP, BUNDLED, fail, HOMES, ISOLATED, ISOLATED_HOMES, ISOLATED_SESSIONS, ORDER, PROFILES, readJson, RUN, SESSIONS, slug, updateJson, WORKSPACE } from "../common.mjs";
import { AGENTS_GID, FIRST_AGENT_UID, ISOLATED_HOME, REGULAR_HOME, SHARED_TOOLS } from "../config.mjs";
import { folder as ownFolder, setOwner, tree } from "../users.mjs";
import { extensionsOf } from "../settings/extensions.mjs";
import { lastMessage } from "./sessions.mjs";

const isAgentId = (id) => /^[a-z0-9-]+$/.test(id);
const folder = (id) => {
  if (!isAgentId(id)) throw fail(404, "This agent does not exist");
  return join(PROFILES, id);
};

const THINKING = ["", "off", "minimal", "low", "medium", "high", "xhigh", "max"];

const ids = (list) => Array.isArray(list) && list.every((id) => typeof id === "string");
export const ALLOW_RULE = /^(skill|action|settings|ask:[a-z0-9-]+)$/;

const clean = ({ name, model, thinking = "", skills = [], plugins = [], extensions = [], disabled = [], instructions = "", avatar, isolated = false, trusted = false, allow = [], dailyTokens = 0 }) => {
  if (typeof name !== "string" || !name.trim()) throw fail(400, "Type a name");
  if (typeof model !== "string" || !model.trim()) throw fail(400, "Choose a model");
  if (typeof instructions !== "string" || !THINKING.includes(thinking) || !ids(skills) || !ids(plugins) || !ids(extensions) || !ids(disabled) || typeof isolated !== "boolean" || typeof trusted !== "boolean" || !ids(allow) || !allow.every((rule) => ALLOW_RULE.test(rule)) || !Number.isSafeInteger(dailyTokens) || dailyTokens < 0) throw fail(400, "The agent settings are not valid");
  const { shape, color } = avatar ?? {};
  return { name: name.trim(), model: model.trim(), thinking, skills, plugins, extensions, disabled, instructions, ...(typeof shape === "string" && typeof color === "string" && { avatar: { shape, color } }), isolated, trusted, allow: [...new Set(allow)], dailyTokens };
};

async function save(id, agent) {
  await updateJson(profilePath(id), () => agent);
  await setOwner(profilePath(id), 0, agent.uid, 0o640);
}

export const isIsolated = (agent) => agent.isolated === true;

export const mayCall = (agent, tool) => !isIsolated(agent) || (!SHARED_TOOLS.includes(tool) && !(Object.hasOwn(BUNDLED, tool) && agent.disabled.includes(tool)));

export const newUid = async () => (await updateJson(APP, (data) => ({ ...data, lastUid: Math.max(FIRST_AGENT_UID, (data.lastUid ?? 0) + 1) }))).lastUid;

export const userOf = (agent) => ({ uid: agent.uid, gid: agent.uid, groups: isIsolated(agent) ? [] : [AGENTS_GID] });

export const homeGroupOf = (agent) => (isIsolated(agent) ? agent.uid : AGENTS_GID);
export const homeKindOf = (agent) => (isIsolated(agent) ? ISOLATED_HOME : REGULAR_HOME);

export async function newFolder(name, taken = []) {
  const used = new Set([...(await readdir(WORKSPACE).catch(() => [])), ...(await readdir(ISOLATED).catch(() => [])), ...taken]);
  const base = slug(name, 24) || "agent";
  let folder = base;
  for (let n = 2; used.has(folder); n++) folder = `${base}-${n}`;
  return folder;
}

export const homeOf = (agent) => {
  if (typeof agent.folder !== "string" || !isAgentId(agent.folder)) throw fail(500, "This agent has no folder");
  return join(isIsolated(agent) ? ISOLATED : WORKSPACE, agent.folder);
};
export const chatDirOf = (agent) => join(isIsolated(agent) ? ISOLATED_SESSIONS : SESSIONS, agent.id);
export const userHomeOf = (agent) => join(isIsolated(agent) ? ISOLATED_HOMES : HOMES, agent.folder);
export const placesOf = (agent) => [homeOf, chatDirOf, userHomeOf].map((place) => place(agent));

export const filesOf = (agent) => (isIsolated(agent) ? { folders: [homeOf(agent)], roots: [homeOf(agent)] } : { folders: [homeOf(agent), WORKSPACE], roots: [WORKSPACE, ISOLATED] });

export const makeHome = (agent) =>
  Promise.all([ownFolder(homeOf(agent), agent.uid, homeGroupOf(agent), homeKindOf(agent).mode), ownFolder(chatDirOf(agent), agent.uid, agent.uid, 0o700), ownFolder(userHomeOf(agent), agent.uid, agent.uid, 0o700)]);

async function move(before, after) {
  const [from, to] = [placesOf(before), placesOf(after)];
  const pairs = from.map((path, i) => [path, to[i]]);
  for (const [, to] of pairs) {
    if (await access(to).then(() => true, () => false)) throw fail(409, `${to} already exists. Rename or remove it, then save again.`);
  }
  for (const [from] of pairs) if ((await lstat(from).catch(() => null))?.isSymbolicLink()) throw fail(409, `${from} is a link, not a folder. Remove it, then save again.`);
  for (const [from, to] of pairs) await rename(from, to).catch((err) => err.code === "ENOENT" || Promise.reject(err));
  await tree(homeOf(after), after.uid, homeGroupOf(after), homeKindOf(after).tree);
}

const withoutBrowser = (agent, before) => (agent.isolated && !before?.isolated ? { ...agent, disabled: [...new Set([...agent.disabled, "browser"])] } : agent);

const read = new Map();
async function readProfile(id) {
  const path = profilePath(id);
  const info = await stat(path);
  const key = `${info.ino}:${info.size}:${info.mtimeMs}`;
  if (read.get(id)?.key !== key) read.set(id, { key, saved: JSON.parse(await readFile(path, "utf8")) });
  return structuredClone(read.get(id).saved);
}

export async function getAgent(id) {
  try {
    const saved = await readProfile(id);
    const agent = { id, thinking: "", skills: [], plugins: [], extensions: [], disabled: [], instructions: "", isolated: false, trusted: false, allow: [], dailyTokens: 0, ...saved };
    return { ...agent, disabled: Array.isArray(agent.disabled) ? agent.disabled.filter((name) => Object.hasOwn(BUNDLED, name)) : [] };
  } catch (err) {
    if (err.code === "ENOENT") read.delete(id);
    throw err.code === "ENOENT" ? fail(404, "This agent does not exist") : err;
  }
}

export async function profiles() {
  const ids = await readdir(PROFILES).catch(() => []);
  return (await Promise.all(ids.map((id) => getAgent(id).catch(() => null)))).filter(Boolean);
}

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

const changing = new Map();
export function updateAgent(id, patch, asked) {
  const run = (changing.get(id) ?? Promise.resolve()).then(() => change(id, patch, asked));
  const tail = run.catch(() => {});
  changing.set(id, tail);
  void tail.then(() => changing.get(id) === tail && changing.delete(id));
  return run;
}

async function change(id, patch, asked) {
  const saved = await getAgent(id);
  const next = typeof patch === "function" ? patch(saved) : patch;
  if (asked && Object.keys(next).some((f) => JSON.stringify(saved[f]) !== JSON.stringify(asked[f]))) throw fail(409, `${saved.name} was changed while the user was asked. Look again, and ask again if it is still needed.`);
  const agent = withoutBrowser(clean({ ...saved, ...next }), saved);
  await extensionsOf(agent);
  if (agent.isolated !== saved.isolated) await move(saved, { ...saved, isolated: agent.isolated });
  await save(id, { ...agent, folder: saved.folder, uid: saved.uid });
  return getAgent(id);
}

export async function removeProfile(id) {
  await getAgent(id);
  await rm(folder(id), { recursive: true, force: true });
}

export async function removeFiles(agent, { keepChat, keepFiles }) {
  const remove = (path) => rm(path, { recursive: true, force: true });
  await Promise.all([remove(userHomeOf(agent)), remove(join(RUN, "pi", agent.id))]);
  await (keepChat ? tree(chatDirOf(agent), 0, 0, "go-rwx") : remove(chatDirOf(agent)));
  await (keepFiles ? tree(homeOf(agent), 0, AGENTS_GID, "g+rwX,o-rwx") : remove(homeOf(agent)));
}

export const profilePath = (id) => join(folder(id), "agent.json");
