import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, chown, lstat, mkdir, open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { AGENT_DIR, EXTENSIONS, HOMES, ISOLATED, ISOLATED_SESSIONS, KNOWLEDGE, PROFILES, ROOT, RUN, SCRATCH, SESSIONS, SKILLS, TOOLS, WORKSPACE } from "./common.mjs";
import { AGENTS_GID, BIN, BROWSER_UID, CURATOR_UID, PLUGINS_UID, SYSTEM_PATH } from "./config.mjs";

const run = promisify(execFile);
export const isRoot = process.getuid?.() === 0;

export const BROWSER = { uid: BROWSER_UID, gid: BROWSER_UID, groups: [] };
export const CURATOR = { uid: CURATOR_UID, gid: CURATOR_UID, groups: [] };
export const PLUGINS = { uid: PLUGINS_UID, gid: PLUGINS_UID, groups: [AGENTS_GID] };

export const sharedTools = { PATH: `${SYSTEM_PATH}:${TOOLS}/bin`, npm_config_prefix: TOOLS, PYTHONUSERBASE: TOOLS };
export const ownTools = (home) => ({ PATH: `${SYSTEM_PATH}:${home}/.local/bin`, npm_config_prefix: `${home}/.local`, PYTHONUSERBASE: `${home}/.local` });

export function spawnAs(user, command, args, options) {
  if (!isRoot) return spawn(command, args, options);
  const groups = user.groups.length ? `--groups=${user.groups.join(",")}` : "--clear-groups";
  return spawn(BIN.setpriv, [`--reuid=${user.uid}`, `--regid=${user.gid}`, groups, "--inh-caps=-all", "--bounding-set=-all", "--no-new-privs", "--", command, ...args], options);
}

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

export async function tree(path, uid, gid, mode) {
  if (!isRoot) return;
  await run(BIN.chown, ["-R", `${uid}:${gid}`, path]).catch(() => {});
  await run(BIN.chmod, ["-R", mode, path]).catch(() => {});
  await run(BIN.find, [path, "-type", "d", "-exec", BIN.chmod, "g+s", "{}", "+"]).catch(() => {});
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
  await folder(SKILLS, 0, AGENTS_GID, 0o2770);
  await folder(EXTENSIONS, 0, AGENTS_GID, 0o2750);
  for (const agent of agents) {
    await folder(join(PROFILES, agent.id), 0, agent.uid, 0o750);
    await setOwner(join(PROFILES, agent.id, "agent.json"), 0, agent.uid, 0o640);
  }
  await folder(WORKSPACE, 0, AGENTS_GID, 0o2770);
  await folder(ISOLATED, 0, AGENTS_GID, 0o751);
  await folder(ISOLATED_SESSIONS, 0, 0, 0o711);
  for (const agent of agents.filter((a) => a.isolated === true && /^[a-z0-9-]+$/.test(a.folder ?? ""))) {
    const home = join(ISOLATED, agent.folder);
    const info = await lstat(home).catch(() => null);
    if (!info?.isDirectory()) continue;
    if (info.gid !== agent.uid) await tree(home, agent.uid, agent.uid, "ug+rwX,o-rwx");
    await folder(home, agent.uid, agent.uid, 0o2770).catch(() => {});
  }
  await folder(HOMES, 0, AGENTS_GID, 0o751);
  await folder(KNOWLEDGE, CURATOR_UID, CURATOR_UID, 0o700);
  await folder(SCRATCH, 0, AGENTS_GID, 0o751);
  await folder(RUN, 0, AGENTS_GID, 0o751);
  await folder(join(RUN, "pi"), 0, AGENTS_GID, 0o751);
  await folder(join(RUN, "pi", "plugins"), PLUGINS_UID, PLUGINS_UID, 0o700);
  const tools = await stat(TOOLS).catch(() => null);
  if (tools && tools.gid !== AGENTS_GID) await tree(TOOLS, 0, AGENTS_GID, "g+rwX,o+rX");
}
