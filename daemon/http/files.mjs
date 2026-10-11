import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, extname, join, sep } from "node:path";
import { pipeline } from "node:stream";
import { fail, WORKSPACE } from "../common.mjs";

// Files in the workspace, for the chat to show and download. Pictures show in the page; anything
// else downloads, so a file an agent wrote can never run as a page of ours. With `view` (the chat's preview) a text file is
// sent as plain text, for the chat to draw, and a PDF inline.
const PICTURES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
// Must match TEXT in ui/src/features/files/kinds.ts.
const TEXT = new Set(
  ".md .markdown .txt .csv .tsv .json .jsonl .log .yaml .yml .toml .xml .html .htm .css .js .mjs .ts .tsx .jsx .py .sh .sql .java .go .rs .c .cpp .h .rb .php .ini".split(" "),
);

export async function serveFile(res, path, view = false) {
  let name;
  try {
    name = decodeURIComponent(path);
  } catch {
    throw fail(404, "Not found");
  }
  // The real path, so a link out of the workspace does not lead out of it.
  const file = await realpath(join(WORKSPACE, name)).catch(() => null);
  if (!file || !file.startsWith((await realpath(WORKSPACE)) + sep)) throw fail(404, "Not found");
  const info = await stat(file);
  if (!info.isFile()) throw fail(404, "Not found");
  const kind = extname(file).toLowerCase();
  const picture = PICTURES[kind];
  const pdf = view && kind === ".pdf";
  const text = view && TEXT.has(kind);
  res.writeHead(200, {
    "Content-Type": picture ?? (pdf ? "application/pdf" : text ? "text/plain; charset=utf-8" : "application/octet-stream"),
    "Content-Length": info.size,
    "Content-Disposition": `${picture || pdf || text ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(basename(file))}`,
    // A PDF stays out of the sandbox: the browser's PDF viewer does not run in one. It cannot run script of ours.
    ...(pdf ? {} : { "Content-Security-Policy": "sandbox" }),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache",
  });
  // pipeline closes the file too when the browser goes away mid-download.
  pipeline(createReadStream(file), res, () => {});
}
