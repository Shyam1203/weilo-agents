import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, chown, lstat, mkdir, open, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { AGENT_DIR, EXTENSIONS, HOMES, ISOLATED, ISOLATED_HOMES, ISOLATED_SESSIONS, PLUGIN_USERS, PLUGINS_CWD, PLUGINS_HOME, KNOWLEDGE, PROFILES, ROOT, RUN, SCRATCH, SESSIONS, SKILLS, TOOLS, updateJson, WORKSPACE } from "./common.mjs";
import { AGENTS_GID, BIN, BROWSER_UID, CURATOR_UID, ISOLATED_HOME, PLUGIN_USERS_FROM, SYSTEM_PATH } from "./config.mjs";

const run = promisify(execFile);
export const isRoot = process.getuid?.() === 0;

export const BROWSER = { uid: BROWSER_UID, gid: BROWSER_UID, groups: [] };
export const CURATOR = { uid: CURATOR_UID, gid: CURATOR_UID, groups: [] };

const PASSED_ON = /^(LANG|LC_\w+|TZ|TERM|NODE_PATH|PIP_BREAK_SYSTEM_PACKAGES|WEILO_VERSION|WEILO_COMMIT|(HTTPS?|NO|ALL)_PROXY|(https?|no|all)_proxy|SSL_CERT_(FILE|DIR)|NODE_EXTRA_CA_CERTS)$/;
export const passedOn = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => PASSED_ON.test(name)));

export const sharedTools = { PATH: `${SYSTEM_PATH}:${TOOLS}/bin`, npm_config_prefix: TOOLS, PYTHONUSERBASE: TOOLS };
export const ownTools = (home) => ({ PATH: `${SYSTEM_PATH}:${home}/.local/bin`, npm_config_prefix: `${home}/.local`, PYTHONUSERBASE: `${home}/.local` });

export const asUser = (user) => [`--reuid=${user.uid}`, `--regid=${user.gid}`, user.groups.length ? `--groups=${user.groups.join(",")}` : "--clear-groups", "--inh-caps=-all", "--bounding-set=-all", "--no-new-privs", "--"];

export const spawnAs = (user, command, args, options) => (isRoot ? spawn(BIN.setpriv, [...asUser(user), command, ...args], options) : spawn(command, args, options));

export async function folder(path, uid, gid, mode) {
  await mkdir(path, { recursive: true });
  if (!isRoot) return;
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    await handle.chown(uid, gid);
    await handle.chmod(mode);
  } finally {
    await handle.close();
  }
}

export async function newFile(path, data, uid, gid, mode) {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try {
    await handle.writeFile(data);
    if (isRoot) await handle.chown(uid, gid);
    await handle.chmod(mode);
  } finally {
    await handle.close();
  }
}

export const setOwner = (path, uid, gid, mode) => (isRoot ? chown(path, uid, gid).then(() => chmod(path, mode), () => {}) : Promise.resolve());

export const shareWithAgents = (path) => setOwner(path, 0, AGENTS_GID, 0o640);

export async function inFolder(path, job) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    return await job(`/proc/${process.pid}/fd/${handle.fd}/`);
  } finally {
    await handle.close();
  }
}

export const writeIn = (dir, name, data, uid, gid, mode) =>
  inFolder(dir, async (at) => {
    const handle = await open(`${at}${name}`, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, mode);
    try {
      await handle.writeFile(data);
      if (isRoot) await handle.chown(uid, gid);
      await handle.chmod(mode);
    } finally {
      await handle.close();
    }
  });

export async function tree(path, uid, gid, mode) {
  if (!isRoot) return;
  await inFolder(path, async (at) => {
    await run(BIN.chown, ["-R", `${uid}:${gid}`, at]).catch(() => {});
    await run(BIN.chmod, ["-R", mode, at]).catch(() => {});
    await run(BIN.find, [at, "-type", "d", "-exec", BIN.chmod, "g+s", "{}", "+"]).catch(() => {});
  }).catch(() => {});
}

export async function pluginUser(name) {
  if (!/^[\w-]+$/.test(name)) throw new Error(`Not a plugin name: ${name}`);
  const numbers = await updateJson(PLUGIN_USERS, (all) => (Object.hasOwn(all, name) ? all : { ...all, [name]: Math.max(-1, ...Object.values(all)) + 1 }));
  const uid = PLUGIN_USERS_FROM + numbers[name];
  const home = join(PLUGINS_HOME, name);
  await folder(home, uid, uid, 0o700);
  return { user: { uid, gid: uid, groups: [AGENTS_GID] }, home };
}

export async function secure(agents) {
  if (!isRoot) return;
  await folder(ROOT, 0, AGENTS_GID, 0o751);
  await folder(AGENT_DIR, 0, AGENTS_GID, 0o750);
  const shared = new Set(["USER.md", "MEMORY.md"]);
  for (const name of await readdir(AGENT_DIR)) {
    const path = join(AGENT_DIR, name);
    const info = await stat(path).catch(() => null);
    if (info?.isFile()) await (shared.has(name) ? shareWithAgents(path) : setOwner(path, 0, 0, 0o600));
  }
  await folder(PROFILES, 0, AGENTS_GID, 0o750);
  await folder(SESSIONS, 0, AGENTS_GID, 0o750);
  await folder(SKILLS, 0, AGENTS_GID, 0o3770);
  await folder(EXTENSIONS, 0, AGENTS_GID, 0o2750);
  for (const agent of agents) {
    await folder(join(PROFILES, agent.id), 0, agent.uid, 0o750);
    await setOwner(join(PROFILES, agent.id, "agent.json"), 0, agent.uid, 0o640);
  }
  await folder(WORKSPACE, 0, AGENTS_GID, 0o3770);
  await folder(ISOLATED, 0, AGENTS_GID, 0o750);
  await folder(ISOLATED_SESSIONS, 0, 0, 0o711);
  await folder(ISOLATED_HOMES, 0, 0, 0o711);
  for (const agent of agents.filter((a) => a.isolated === true && /^[a-z0-9-]+$/.test(a.folder ?? ""))) {
    const home = join(ISOLATED, agent.folder);
    const info = await lstat(home).catch(() => null);
    if (!info?.isDirectory()) continue;
    if (info.gid !== agent.uid) await tree(home, agent.uid, agent.uid, ISOLATED_HOME.tree);
    await folder(home, agent.uid, agent.uid, ISOLATED_HOME.mode).catch(() => {});
  }
  await folder(HOMES, 0, AGENTS_GID, 0o751);
  await folder(KNOWLEDGE, CURATOR_UID, CURATOR_UID, 0o700);
  await folder(SCRATCH, 0, AGENTS_GID, 0o751);
  await folder(RUN, 0, AGENTS_GID, 0o751);
  await folder(join(RUN, "pi"), 0, AGENTS_GID, 0o751);
  await folder(PLUGINS_HOME, 0, 0, 0o711);
  await rm(join(PLUGINS_HOME, "mcp.json"), { force: true });
  await rm(join(RUN, "chats.db"), { force: true });
  await folder(PLUGINS_CWD, 0, 0, 0o755);
  const tools = await stat(TOOLS).catch(() => null);
  if (tools && tools.gid !== AGENTS_GID) await tree(TOOLS, 0, AGENTS_GID, "g+rwX,o+rX");
}
