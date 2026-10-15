import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fail } from "../common.mjs";

const UI = join(import.meta.dirname, "..", "ui");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

export async function serveUi(req, res) {
  if (req.method !== "GET") throw fail(405, "Method not allowed");
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    throw fail(404, "Not found");
  }
  for (const file of [join(UI, normalize(path)), join(UI, "index.html")]) {
    if (!file.startsWith(UI + sep)) continue;
    const data = await readFile(file).catch(() => null);
    if (!data) continue;
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "frame-src about:; frame-ancestors 'none'",
      "Cache-Control": path.startsWith("/assets/") && !file.endsWith("index.html") ? "public, max-age=31536000, immutable" : "no-cache",
    });
    return res.end(data);
  }
  throw fail(404, "Not found");
}
