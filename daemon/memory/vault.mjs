import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { KNOWLEDGE, unsafe } from "../common.mjs";
import { CURATOR_UID } from "../config.mjs";
import { folder } from "../users.mjs";

const DEPTH = 4;

export const ensureVault = () => folder(KNOWLEDGE, CURATOR_UID, CURATOR_UID, 0o700);

async function* files(dir, depth = 0) {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && depth < DEPTH && !entry.name.startsWith(".")) yield* files(path, depth + 1);
    else if (entry.isFile() && entry.name.endsWith(".md")) yield path;
  }
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

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

const REMOVED = { secret: "[removed: looked like a secret]", steering: "[removed: looked like an instruction]" };

export async function scrub(since) {
  for await (const path of files(KNOWLEDGE)) {
    const info = await stat(path).catch(() => null);
    if (!info || info.mtimeMs < since) continue;
    const raw = await readFile(path, "utf8");
    const clean = raw.split("\n").map((line) => REMOVED[unsafe(line)] ?? line).join("\n");
    if (clean !== raw) await writeFile(path, clean);
  }
}
