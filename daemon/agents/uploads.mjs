import { randomBytes } from "node:crypto";
import { basename, join } from "node:path";
import { fail } from "../common.mjs";
import { folder, newFile } from "../users.mjs";
import { homeGroupOf, homeModeOf, homeOf } from "./agents.mjs";

const IMAGE = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/;

const list = (value) => {
  if (!Array.isArray(value)) throw fail(400, "The attachments are not valid");
  return value;
};

export const toImages = (urls = []) =>
  list(urls).map((url) => {
    const match = IMAGE.exec(url);
    if (!match) throw fail(400, "Attach only PNG, JPEG, GIF or WebP images");
    return { type: "image", data: match[2], mimeType: match[1] };
  });

export async function saveFiles(agent, files = []) {
  for (const file of list(files)) {
    if (typeof file?.name !== "string" || typeof file.data !== "string") throw fail(400, "The attachments are not valid");
  }
  if (!files.length) return [];
  const home = homeOf(agent);
  const group = homeGroupOf(agent);
  await folder(join(home, "uploads"), agent.uid, group, homeModeOf(agent));
  return Promise.all(
    files.map(async ({ name, data }) => {
      const safe = basename(name).replace(/[^\w.\- ]/g, "_").slice(-100) || "file";
      const path = `uploads/${randomBytes(4).toString("hex")}-${safe}`;
      await newFile(join(home, path), Buffer.from(data, "base64"), agent.uid, group, homeModeOf(agent) & 0o664);
      return path;
    }),
  );
}
