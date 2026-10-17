import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream";
import { fail, RUN } from "../common.mjs";

const DIR = join(RUN, "images");
const TYPES = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" };
const NAME = /^[0-9a-f]{32}\.(png|jpg|gif|webp)$/;
const saved = new Map();

function keep(data, mimeType) {
  const end = TYPES[mimeType];
  if (!end) return null;
  const name = `${createHash("sha256").update(data).digest("hex").slice(0, 32)}${end}`;
  if (!saved.has(name)) {
    const writing = mkdir(DIR, { recursive: true, mode: 0o700 }).then(() => writeFile(join(DIR, name), Buffer.from(data, "base64"), { mode: 0o600 }));
    saved.set(name, writing);
    writing.catch(() => saved.delete(name));
  }
  return name;
}

const hasImages = (message) => Array.isArray(message?.content) && message.content.some((b) => b.type === "image" && typeof b.data === "string");

export function linkImages(message, link = true) {
  if (!hasImages(message)) return message;
  const content = message.content.map((block) => {
    if (block.type !== "image" || typeof block.data !== "string") return block;
    const { data, ...rest } = block;
    const name = link && keep(data, block.mimeType);
    return name ? { ...rest, url: `/api/images/${name}` } : rest;
  });
  return { ...message, content };
}

export async function serveImage(res, name) {
  if (!NAME.test(name)) throw fail(404, "Not found");
  await saved.get(name)?.catch(() => {});
  const handle = await open(join(DIR, name), constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (!handle) throw fail(404, "Not found");
  const { size } = await handle.stat();
  const type = Object.entries(TYPES).find(([, end]) => name.endsWith(end))[0];
  res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
  pipeline(handle.createReadStream(), res, () => {});
}
