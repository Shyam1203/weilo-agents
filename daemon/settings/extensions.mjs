import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import { BUNDLED, EXTENSIONS, fail } from "../common.mjs";
import { AGENTS_GID, RESERVED_TOOLS } from "../config.mjs";
import { tree } from "../users.mjs";
import { unzip } from "./zip.mjs";

const ID = /^[a-z0-9-]+$/;
const TOOL = /^[\w-]+$/;
const text = (value) => typeof value === "string" && value.trim();

const manifestOf = (folder) => readFile(join(folder, "weilo.json"), "utf8").then(JSON.parse);

const read = async (folder, id, builtin) => {
  if (!ID.test(id)) return null;
  const m = await manifestOf(folder).catch(() => null);
  return m && { id, name: m.title || id, description: m.description ?? "", tools: m.tools ?? [], entry: join(folder, m.entry), builtin };
};

const readAll = async (dir) => (await Promise.all((await readdir(dir).catch(() => [])).map((id) => read(join(dir, id), id, false)))).filter(Boolean);
const bundled = async () => (await Promise.all(Object.entries(BUNDLED).map(([id, folder]) => read(folder, id, true)))).filter(Boolean);

export async function listExtensions() {
  const [own, added] = await Promise.all([bundled(), readAll(EXTENSIONS)]);
  return [...own, ...added.filter((x) => !own.some((o) => o.id === x.id))].map(({ entry, ...shown }) => shown);
}

export async function extensionsOf({ disabled, extensions }) {
  const own = (await bundled()).filter((x) => !disabled.includes(x.id));
  const added = (await Promise.all(extensions.filter((id) => !own.some((o) => o.id === id)).map((id) => read(join(EXTENSIONS, id), id, false))))
    .filter((x) => x && !x.tools.some((t) => RESERVED_TOOLS.includes(t)));
  const all = [...own, ...added];
  const tools = all.flatMap((x) => x.tools);
  const twice = tools.find((t, i) => tools.indexOf(t) !== i);
  if (twice) throw fail(400, `Two extensions add the tool "${twice}". Turn one of them off.`);
  return all;
}

async function manifestFolder(top) {
  const has = (dir) => stat(join(dir, "weilo.json")).then(() => true, () => false);
  if (await has(top)) return top;
  const dirs = (await readdir(top, { withFileTypes: true })).filter((e) => e.isDirectory());
  if (dirs.length === 1 && (await has(join(top, dirs[0].name)))) return join(top, dirs[0].name);
  throw fail(400, "The file does not contain a weilo.json");
}

async function check(folder) {
  const m = await manifestOf(folder).catch(() => {
    throw fail(400, "The weilo.json is not valid JSON");
  });
  if (m.apiVersion !== 1) throw fail(400, "The weilo.json needs apiVersion 1");
  if (!ID.test(m.name ?? "")) throw fail(400, "The name in weilo.json can have only lowercase letters, digits and hyphens");
  if ((await bundled()).some((x) => x.id === m.name)) throw fail(400, `The name "${m.name}" is already in use`);
  if (!text(m.description)) throw fail(400, "The weilo.json needs a description");
  if (m.title !== undefined && !text(m.title)) throw fail(400, "The title in weilo.json is not valid");
  const tools = m.tools ?? [];
  if (!Array.isArray(tools) || !tools.every((t) => typeof t === "string" && TOOL.test(t))) throw fail(400, "The tools in weilo.json are not valid");
  const taken = tools.find((t) => RESERVED_TOOLS.includes(t));
  if (taken) throw fail(400, `The tool name "${taken}" is already in use`);
  const entry = typeof m.entry === "string" && resolve(folder, m.entry);
  if (!entry || relative(folder, entry).startsWith("..") || !(await stat(entry).then((s) => s.isFile(), () => false))) throw fail(400, "The entry in weilo.json is not a file in the extension");
  if (![".js", ".mjs", ".ts"].includes(extname(entry))) throw fail(400, "The entry in weilo.json must be a .js, .mjs or .ts file");
  return m.name;
}

export async function addExtension({ name, data }) {
  if (typeof name !== "string" || typeof data !== "string") throw fail(400, "The file is not valid");
  if (extname(name).toLowerCase() !== ".zip") throw fail(400, "Add a .zip file");
  const work = await mkdtemp(join(tmpdir(), "extension-"));
  try {
    const folder = await manifestFolder(await unzip(work, data, "extension"));
    const id = await check(folder);
    await mkdir(EXTENSIONS, { recursive: true });
    await rm(join(EXTENSIONS, id), { recursive: true, force: true });
    await cp(folder, join(EXTENSIONS, id), { recursive: true });
    await tree(join(EXTENSIONS, id), 0, AGENTS_GID, "g+rX,g-w,o-rwx");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function removeExtension(id) {
  if (!ID.test(id)) throw fail(404, "This extension does not exist");
  if ((await bundled()).some((x) => x.id === id)) throw fail(400, "An extension that comes with the app cannot be deleted. Turn it off for an agent instead");
  await rm(join(EXTENSIONS, id), { recursive: true, force: true });
}
