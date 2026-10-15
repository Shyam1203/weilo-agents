import { execFile, spawn } from "node:child_process";
import { chmod, chown, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { AGENT_DIR, HOMES, KNOWLEDGE, ROOT, RUN, SCRATCH, TOOLS, WORKSPACE } from "./common.mjs";
import { AGENTS_GID, BIN, BROWSER_UID, CURATOR_UID, PLUGINS_UID, SYSTEM_PATH } from "./config.mjs";

// Who runs what, and who may read what. The daemon is root and keeps the keys (agent/: provider keys, plugin secrets,
// paired devices) where no one else can read them. Everything else it starts runs as a user of its own, without root's
// powers: the browser as the image's user, the knowledge curator and the plugins as theirs, and each agent as its own
// user, in the `agents` group. The group shares the workspace, the installed tools and the skills; an agent's chat, home,
// scratch and pi settings are its own. Pi runs with only what its agent may use (agents/pidir.mjs); a model's key and a
// plugin's secrets stay with the daemon, which adds them on the way out (gateway/).
// Outside a root daemon (a dev run) everything runs as the daemon, and nothing is changed hands.

const run = promisify(execFile);
export const isRoot = process.getuid?.() === 0;

export const BROWSER = { uid: BROWSER_UID, gid: BROWSER_UID, groups: [] };
export const CURATOR = { uid: CURATOR_UID, gid: CURATOR_UID, groups: [] };
// A plugin that runs as a program reads and writes the workspace, as the agent that uses it would.
export const PLUGINS = { uid: PLUGINS_UID, gid: PLUGINS_UID, groups: [AGENTS_GID] };

// What the programs a user starts find by name: root's folders, then the tools the agents install (shared with their group)
// or, for an isolated agent, its own (in its HOME). Never before root's: a `node` an agent put there would run in every
// other agent's pi.
export const sharedTools = { PATH: `${SYSTEM_PATH}:${TOOLS}/bin`, npm_config_prefix: TOOLS, PYTHONUSERBASE: TOOLS };
export const ownTools = (home) => ({ PATH: `${SYSTEM_PATH}:${home}/.local/bin`, npm_config_prefix: `${home}/.local`, PYTHONUSERBASE: `${home}/.local` });

// `spawn`, as `user`: setpriv changes user and drops every capability, for good, before the program starts.
export function spawnAs(user, command, args, options) {
  if (!isRoot) return spawn(command, args, options);
  const groups = user.groups.length ? `--groups=${user.groups.join(",")}` : "--clear-groups";
  return spawn(BIN.setpriv, [`--reuid=${user.uid}`, `--regid=${user.gid}`, groups, "--inh-caps=-all", "--bounding-set=-all", "--no-new-privs", "--", command, ...args], options);
}

// A folder, made if missing, with this owner and mode (a mode with 0o2000 keeps the folder's group on what is made in it).
export async function folder(path, uid, gid, mode) {
  await mkdir(path, { recursive: true });
  if (!isRoot) return;
  await chown(path, uid, gid);
  await chmod(path, mode);
}

// A file's owner and mode, if it exists.
export const setOwner = (path, uid, gid, mode) => (isRoot ? chown(path, uid, gid).then(() => chmod(path, mode), () => {}) : Promise.resolve());

// A file of root's that every agent's pi reads (what it knows about you, its memory).
export const shareWithAgents = (path) => setOwner(path, 0, AGENTS_GID, 0o640);

// A whole tree's owner, and a change of its modes (chmod's symbols, such as "g+rwX,o-rwx"); its folders keep their group
// on what is made in them.
export async function tree(path, uid, gid, mode) {
  if (!isRoot) return;
  await run(BIN.chown, ["-R", `${uid}:${gid}`, path]).catch(() => {});
  await run(BIN.chmod, ["-R", mode, path]).catch(() => {});
  await run(BIN.find, [path, "-type", "d", "-exec", BIN.chmod, "g+s", "{}", "+"]).catch(() => {});
}

// Owners and modes of what the app keeps, set at every start (the data folder may come from an older app, which ran as one
// user). Only the top of each place: what is in it was set when it was made, or by migrate.mjs.
export async function secure(agents) {
  if (!isRoot) return;
  await folder(ROOT, 0, AGENTS_GID, 0o751);
  // agent/: the group may look in (an agent's pi reads its profile, the skills and what it knows about you); its files are
  // root's alone, but for those.
  await folder(AGENT_DIR, 0, AGENTS_GID, 0o750);
  const shared = new Set(["USER.md", "MEMORY.md"]);
  for (const name of await readdir(AGENT_DIR)) {
    const path = join(AGENT_DIR, name);
    const info = await stat(path).catch(() => null);
    if (info?.isFile()) await (shared.has(name) ? shareWithAgents(path) : setOwner(path, 0, 0, 0o600));
  }
  await folder(join(AGENT_DIR, "profiles"), 0, AGENTS_GID, 0o750);
  await folder(join(AGENT_DIR, "sessions"), 0, AGENTS_GID, 0o750);
  // Skills: agents add files to a skill they made (scripts it needs). Extensions are code every pi runs: read only.
  await folder(join(AGENT_DIR, "skills"), 0, AGENTS_GID, 0o2770);
  await folder(join(AGENT_DIR, "extensions"), 0, AGENTS_GID, 0o2750);
  for (const agent of agents) {
    await folder(join(AGENT_DIR, "profiles", agent.id), 0, agent.uid, 0o750);
    await setOwner(join(AGENT_DIR, "profiles", agent.id, "agent.json"), 0, agent.uid, 0o640);
  }
  await folder(WORKSPACE, 0, AGENTS_GID, 0o2770);
  await folder(HOMES, 0, AGENTS_GID, 0o751);
  await folder(KNOWLEDGE, CURATOR_UID, CURATOR_UID, 0o700);
  await folder(SCRATCH, 0, AGENTS_GID, 0o751);
  await folder(RUN, 0, AGENTS_GID, 0o751);
  await folder(join(RUN, "pi"), 0, AGENTS_GID, 0o751);
  await folder(join(RUN, "pi", "plugins"), PLUGINS_UID, PLUGINS_UID, 0o700);
  // The installed tools (a volume) were the image user's; the group shares them now.
  const tools = await stat(TOOLS).catch(() => null);
  if (tools && tools.gid !== AGENTS_GID) await tree(TOOLS, 0, AGENTS_GID, "g+rwX,o+rX");
}
