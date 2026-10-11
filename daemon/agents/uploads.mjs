import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fail, WORKSPACE } from "../common.mjs";

// What a message carries besides text. Images go to the model as they are; other files are
// saved in the workspace and the message names where.
const UPLOADS = join(WORKSPACE, "uploads");
const IMAGE = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/;

const list = (value) => {
  if (!Array.isArray(value)) throw fail(400, "The attachments are not valid");
  return value;
};

// Data URLs to pi's image blocks.
export const toImages = (urls = []) =>
  list(urls).map((url) => {
    const match = IMAGE.exec(url);
    if (!match) throw fail(400, "Attach only PNG, JPEG, GIF or WebP images");
    return { type: "image", data: match[2], mimeType: match[1] };
  });

// [{ name, data: base64 }] to files in the workspace; returns their paths from there. All are checked before any is saved.
export async function saveFiles(files = []) {
  for (const file of list(files)) {
    if (typeof file?.name !== "string" || typeof file.data !== "string") throw fail(400, "The attachments are not valid");
  }
  await mkdir(UPLOADS, { recursive: true });
  return Promise.all(
    files.map(async ({ name, data }) => {
      const safe = basename(name).replace(/[^\w.\- ]/g, "_").slice(-100) || "file";
      const path = `uploads/${randomBytes(4).toString("hex")}-${safe}`;
      await writeFile(join(WORKSPACE, path), Buffer.from(data, "base64"));
      return path;
    }),
  );
}
