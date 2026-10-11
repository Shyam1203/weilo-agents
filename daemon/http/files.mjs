import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, extname, join, sep } from "node:path";
import { pipeline } from "node:stream";
import { fail, WORKSPACE } from "../common.mjs";

// Files in the workspace, for the chat to show and download. Pictures show in the page; anything
// else downloads, so a file an agent wrote can never run as a page of ours.
const PICTURES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

export async function serveFile(res, path) {
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
  const picture = PICTURES[extname(file).toLowerCase()];
  res.writeHead(200, {
    "Content-Type": picture ?? "application/octet-stream",
    "Content-Length": info.size,
    "Content-Disposition": `${picture ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(basename(file))}`,
    "Content-Security-Policy": "sandbox",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache",
  });
  // pipeline closes the file too when the browser goes away mid-download.
  pipeline(createReadStream(file), res, () => {});
}
