import { constants } from "node:fs";
import { open, readlink, realpath } from "node:fs/promises";
import { basename, extname, join, sep } from "node:path";
import { pipeline } from "node:stream";
import { fail } from "../common.mjs";

const PICTURES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
const TEXT = new Set(
  ".md .markdown .txt .csv .tsv .json .jsonl .log .yaml .yml .toml .xml .html .htm .css .js .mjs .ts .tsx .jsx .py .sh .sql .java .go .rs .c .cpp .h .rb .php .ini".split(" "),
);

async function find(roots, path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK).catch(() => null);
  if (!handle) return null;
  const file = await readlink(`/proc/self/fd/${handle.fd}`).catch(() => null);
  const info = await handle.stat();
  if (file && info.isFile() && roots.some((root) => root && file.startsWith(root + sep))) return { handle, file, info };
  await handle.close();
  return null;
}

export async function serveFile(res, { folders, roots }, path, view = false) {
  let name;
  try {
    name = decodeURIComponent(path);
  } catch {
    throw fail(404, "Not found");
  }
  const real = await Promise.all(roots.map((root) => realpath(root).catch(() => null)));
  let found = null;
  for (const dir of name.startsWith("/") ? ["/"] : folders) found ??= await find(real, join(dir, name));
  if (!found) throw fail(404, "Not found");
  const { handle, file, info } = found;
  const kind = extname(file).toLowerCase();
  const picture = PICTURES[kind];
  const pdf = view && kind === ".pdf";
  const text = view && TEXT.has(kind);
  res.writeHead(200, {
    "Content-Type": picture ?? (pdf ? "application/pdf" : text ? "text/plain; charset=utf-8" : "application/octet-stream"),
    "Content-Length": info.size,
    "Content-Disposition": `${picture || pdf || text ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(basename(file))}`,
    ...(pdf ? {} : { "Content-Security-Policy": "sandbox" }),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache",
  });
  pipeline(handle.createReadStream(), res, () => {});
}
