import { execFile } from "node:child_process";
import { mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { homeKindOf, homeOf, isIsolated, newFolder, newUid, profilePath, profiles, userHomeOf } from "./agents/agents.mjs";
import { AGENT_DIR, APP, HOMES, ISOLATED_HOMES, KNOWLEDGE, readJson, ROOT, SESSIONS, TOOLS, updateJson, WORKSPACE } from "./common.mjs";
import { AGENTS_GID, BIN, CURATOR_UID, FIRST_AGENT_UID } from "./config.mjs";
import { tree } from "./users.mjs";
import { BUILD } from "./version.mjs";

export const DATA_VERSION = 5;
const STEPS = {
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
  async 2() {
    for (const agent of await profiles()) {
      const uid = Number.isInteger(agent.uid) ? agent.uid : await newUid();
      await updateJson(profilePath(agent.id), (data) => ({ ...data, uid }));
    }
    await tree(WORKSPACE, 0, AGENTS_GID, "g+rwX,o-rwx");
    await tree(join(AGENT_DIR, "skills"), 0, AGENTS_GID, "g+rwX,o-rwx");
    await tree(join(AGENT_DIR, "extensions"), 0, AGENTS_GID, "g+rX,g-w,o-rwx");
    await tree(KNOWLEDGE, CURATOR_UID, CURATOR_UID, "go-rwx");
    await tree(SESSIONS, 0, 0, "go-rwx");
    for (const agent of await profiles()) {
      await tree(homeOf(agent), agent.uid, AGENTS_GID, "g+rwX,o-rwx");
      await tree(join(SESSIONS, agent.id), agent.uid, agent.uid, "go-rwx");
    }
  },
  async 3() {
    for (const agent of await profiles()) await updateJson(profilePath(agent.id), (data) => ({ ...data, isolated: data.isolated === true, trusted: data.trusted === true }));
    const { stdout } = await promisify(execFile)(BIN.find, [ROOT, TOOLS, "-uid", `+${FIRST_AGENT_UID - 1}`, "-printf", "%U\n"], { maxBuffer: 1 << 28 }).catch((err) => err);
    const owners = (stdout ?? "").split("\n").filter(Boolean).map(Number);
    const uids = [...owners, ...(await profiles()).map((a) => a.uid)].filter(Number.isInteger);
    await updateJson(APP, (data) => ({ ...data, lastUid: Math.max(data.lastUid ?? 0, ...uids) }));
  },
  async 4() {
    await mkdir(ISOLATED_HOMES, { recursive: true });
    for (const agent of (await profiles()).filter(isIsolated)) {
      await rename(join(HOMES, agent.folder), userHomeOf(agent)).catch((err) => err.code === "ENOENT" || Promise.reject(err));
      await tree(homeOf(agent), agent.uid, agent.uid, homeKindOf(agent).tree);
    }
  },
};

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
