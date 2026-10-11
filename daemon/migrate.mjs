import { APP, readJson, updateJson } from "./common.mjs";
import { BUILD } from "./version.mjs";

// The shape of the files in the data folder, kept in weilo.json beside agent/ and workspace/. A change an older folder needs a
// step for raises DATA_VERSION, and STEPS[n] changes a folder of version n into one of version n + 1 (it runs once, at start,
// before anything reads the files). A folder from before this file existed is version 1, the shape of today.
export const DATA_VERSION = 1;
const STEPS = {};

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
