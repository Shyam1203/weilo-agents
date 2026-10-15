import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { homeOf, newFolder, newUid, profilePath, profiles } from "./agents/agents.mjs";
import { AGENT_DIR, APP, KNOWLEDGE, readJson, ROOT, SESSIONS, TOOLS, updateJson, WORKSPACE } from "./common.mjs";
import { AGENTS_GID, BIN, CURATOR_UID, FIRST_AGENT_UID } from "./config.mjs";
import { tree } from "./users.mjs";
import { BUILD } from "./version.mjs";

// The shape of the files in the data folder, kept in weilo.json beside agent/ and workspace/. A change an older folder needs a
// step for raises DATA_VERSION, and STEPS[n] changes a folder of version n into one of version n + 1 (it runs once, at start,
// before anything reads the files). A folder from before this file existed is version 1, the shape of today.
export const DATA_VERSION = 4;
const STEPS = {
  // 2: each agent has a home folder in the workspace. What is already in the workspace stays where it is, shared.
  async 1() {
    const taken = [];
    for (const agent of await profiles()) {
      if (agent.folder) continue;
      const folder = await newFolder(agent.name, taken);
      taken.push(folder);
      await updateJson(profilePath(agent.id), (data) => ({ ...data, folder }));
      await mkdir(join(WORKSPACE, folder), { recursive: true });
    }
  },
  // 3: each agent runs as a Linux user of its own (users.mjs). Everything was the image user's: the workspace, the skills and
  // the extensions go to the agents' group (an agent's own folder and chat to its user), the vault to the curator.
  async 2() {
    for (const agent of await profiles()) {
      const uid = Number.isInteger(agent.uid) ? agent.uid : await newUid();
      await updateJson(profilePath(agent.id), (data) => ({ ...data, uid }));
    }
    await tree(WORKSPACE, 0, AGENTS_GID, "g+rwX,o-rwx");
    await tree(join(AGENT_DIR, "skills"), 0, AGENTS_GID, "g+rwX,o-rwx");
    await tree(join(AGENT_DIR, "extensions"), 0, AGENTS_GID, "g+rX,g-w,o-rwx");
    await tree(KNOWLEDGE, CURATOR_UID, CURATOR_UID, "go-rwx");
    // Chats kept from deleted agents are root's; each agent's own, its user's.
    await tree(SESSIONS, 0, 0, "go-rwx");
    for (const agent of await profiles()) {
      await tree(homeOf(agent), agent.uid, AGENTS_GID, "g+rwX,o-rwx");
      await tree(join(SESSIONS, agent.id), agent.uid, agent.uid, "go-rwx");
    }
  },
  // 4: an agent's user is never given again (agents.mjs `newUid`). The highest so far is the highest of the agents' and of
  // the owners of the files deleted agents left in the data folder and the installed tools.
  async 3() {
    // find fails on a folder that is missing (no tools yet); what it found is still in its output.
    const { stdout } = await promisify(execFile)(BIN.find, [ROOT, TOOLS, "-uid", `+${FIRST_AGENT_UID - 1}`, "-printf", "%U\n"], { maxBuffer: 1 << 28 }).catch((err) => err);
    const owners = (stdout ?? "").split("\n").filter(Boolean).map(Number);
    const uids = [...owners, ...(await profiles()).map((a) => a.uid)].filter(Number.isInteger);
    await updateJson(APP, (data) => ({ ...data, lastUid: Math.max(data.lastUid ?? 0, ...uids) }));
  },
};

// A folder made by a newer app is refused: running on it could corrupt it.
export async function migrate() {
  const { dataVersion = 1 } = await readJson(APP);
  if (dataVersion > DATA_VERSION) {
    throw new Error(`The data folder was made by a newer Weilo Agents (data version ${dataVersion}; this app, ${BUILD.version}, reads up to ${DATA_VERSION}). Update the app, or restore the folder from a backup.`);
  }
  for (let version = dataVersion; version < DATA_VERSION; version++) {
    await STEPS[version]();
    await updateJson(APP, (data) => ({ ...data, dataVersion: version + 1 }));
  }
  await updateJson(APP, (data) => ({ ...data, dataVersion: DATA_VERSION, version: BUILD.version }));
}
