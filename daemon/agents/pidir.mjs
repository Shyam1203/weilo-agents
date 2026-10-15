import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readJson, RUN, SETTINGS } from "../common.mjs";
import { piModels } from "../gateway/models.mjs";
import { piPlugins } from "../gateway/plugins.mjs";
import { folder, setOwner } from "../users.mjs";

export const piDirOf = (name) => join(RUN, "pi", name);

export async function piFiles({ model, plugins = [], key, agent }) {
  const files = { "settings.json": await readJson(SETTINGS), "models.json": await piModels(model, key) };
  if (plugins.length) files["mcp.json"] = await piPlugins(plugins, key, agent);
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, JSON.stringify(data, null, 2)]));
}

export async function writePiDir(dir, owner, files) {
  await rm(dir, { recursive: true, force: true });
  await folder(dir, 0, 0, 0o700);
  for (const [name, text] of Object.entries(files)) {
    await writeFile(join(dir, name), text, { mode: 0o600 });
    await setOwner(join(dir, name), owner.uid, owner.gid, 0o600);
  }
  await folder(dir, owner.uid, owner.gid, 0o700);
}
