import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { KNOWLEDGE, SECRET } from "../common.mjs";

// The knowledge vault: folders of markdown pages in `.pi/knowledge`, kept by the curator (curator.mjs) and searched by agents
// (fetch.mjs). A page may start with frontmatter, `sources: [<agent id>@<date>, ...]`: the chats it was drawn from, so an
// agent can check a claim against the chat. Agents may edit pages by hand too; nothing here needs the frontmatter.
const DEPTH = 4;

export const ensureVault = () => mkdir(KNOWLEDGE, { recursive: true });

async function* files(dir, depth = 0) {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && depth < DEPTH && !entry.name.startsWith(".")) yield* files(path, depth + 1);
    else if (entry.isFile() && entry.name.endsWith(".md")) yield path;
  }
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// A page: its path in the vault, title (the first "# " line, or the file name), sources and text.
function parsePage(path, raw) {
  const rel = relative(KNOWLEDGE, path).replaceAll("\\", "/");
  const front = FRONT.exec(raw);
  const body = front ? raw.slice(front[0].length) : raw;
  const list = /^sources:\s*\[(.*)\]\s*$/m.exec(front?.[1] ?? "")?.[1] ?? "";
  return {
    rel,
    title: /^# (.+)/m.exec(body)?.[1]?.trim() ?? rel.replace(/\.md$/, ""),
    sources: list.split(",").map((s) => s.trim()).filter(Boolean),
    body: body.trim(),
  };
}

export async function pagesOf() {
  const pages = [];
  for await (const path of files(KNOWLEDGE)) pages.push(parsePage(path, await readFile(path, "utf8").catch(() => "")));
  return pages;
}

// The curator is told to keep secrets out, but a model can slip: a line of a page it just wrote that looks like a key,
// token, password or card number is replaced before anyone reads it.
export async function scrub(since) {
  for await (const path of files(KNOWLEDGE)) {
    const info = await stat(path).catch(() => null);
    if (!info || info.mtimeMs < since) continue;
    const raw = await readFile(path, "utf8");
    const clean = raw.split("\n").map((line) => (SECRET.test(line) ? "[removed: looked like a secret]" : line)).join("\n");
    if (clean !== raw) await writeFile(path, clean);
  }
}
