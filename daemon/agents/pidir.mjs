import { cp, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readJson, RUN, SETTINGS } from "../common.mjs";
import { piModels } from "../gateway/models.mjs";
import { piPlugins } from "../gateway/plugins.mjs";
import { folder, setOwner, tree } from "../users.mjs";

export const piDirOf = (name) => join(RUN, "pi", name);

export async function writePiDir(dir, owner, { model, plugins = [], key, agent, copies = {} }) {
  await rm(dir, { recursive: true, force: true });
  await folder(dir, 0, 0, 0o700);
  const files = { "settings.json": await readJson(SETTINGS), "models.json": await piModels(model, key) };
  if (plugins.length) files["mcp.json"] = await piPlugins(plugins, key, agent);
  for (const [name, data] of Object.entries(files)) {
    await writeFile(join(dir, name), JSON.stringify(data, null, 2), { mode: 0o600 });
    await setOwner(join(dir, name), owner.uid, owner.gid, 0o600);
  }
  for (const [name, source] of Object.entries(copies)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await cp(source, join(dir, name), { recursive: true, filter: async (path) => !(await lstat(path)).isSymbolicLink() });
  }
  for (const top of new Set(Object.keys(copies).map((name) => name.split("/")[0]))) await tree(join(dir, top), 0, 0, "u+rwX,go+rX,go-w");
  await folder(dir, owner.uid, owner.gid, 0o700);
}
