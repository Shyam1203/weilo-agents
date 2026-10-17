import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { fail } from "../common.mjs";

const UI = join(import.meta.dirname, "..", "ui");
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

const SQUEEZE = new Set([".html", ".js", ".css", ".json", ".svg", ".webmanifest"]);
const squeeze = { br: (data) => promisify(brotliCompress)(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }), gzip: promisify(gzip) };
const files = new Map();

const load = (file) => {
  if (!files.has(file)) {
    const loading = readFile(file).then(async (data) => {
      const built = (end) => readFile(`${file}${end}`).catch(() => null);
      const small = SQUEEZE.has(extname(file)) ? { br: (await built(".br")) ?? (await squeeze.br(data)), gzip: (await built(".gz")) ?? (await squeeze.gzip(data)) } : {};
      return { data, ...small, etag: `"${createHash("sha256").update(data).digest("base64url").slice(0, 16)}"` };
    });
    files.set(file, loading);
    loading.catch(() => files.delete(file));
  }
  return files.get(file).catch(() => null);
};

export async function serveUi(req, res) {
  if (req.method !== "GET") throw fail(405, "Method not allowed");
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    throw fail(404, "Not found");
  }
  const asset = path.startsWith("/assets/");
  for (const file of [join(UI, normalize(path)), ...(asset ? [] : [join(UI, "index.html")])]) {
    if (!file.startsWith(UI + sep)) continue;
    const found = await load(file);
    if (!found) continue;
    const accepts = String(req.headers["accept-encoding"] ?? "");
    const encoding = ["br", "gzip"].find((e) => found[e] && new RegExp(`\\b${e}\\b(?!;\\s*q=0(\\.0*)?\\b)`).test(accepts));
    const headers = {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "frame-src about:; frame-ancestors 'none'",
      "Cache-Control": asset ? "public, max-age=31536000, immutable" : "no-cache",
      ETag: found.etag,
      Vary: "Accept-Encoding",
    };
    if (req.headers["if-none-match"] === found.etag) return res.writeHead(304, headers).end();
    res.writeHead(200, { ...headers, ...(encoding && { "Content-Encoding": encoding }) });
    return res.end(encoding ? found[encoding] : found.data);
  }
  throw fail(404, "Not found");
}
