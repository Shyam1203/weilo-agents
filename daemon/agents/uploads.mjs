import { randomBytes } from "node:crypto";
import { lstat } from "node:fs/promises";
import { basename, join } from "node:path";
import { fail } from "../common.mjs";
import { folder, newFile } from "../users.mjs";
import { homeGroupOf, homeKindOf, homeOf } from "./agents.mjs";

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

const UPLOADED = /^uploads\/[0-9a-f]{8}-[\w.\- ]{1,100}$/;

// A file is sent on its own, as it is, before the message that names it.
export async function saveUpload(agent, name, data) {
  if (typeof name !== "string" || !name) throw fail(400, "The file has no name");
  const home = homeOf(agent);
  const [group, kind] = [homeGroupOf(agent), homeKindOf(agent)];
  await folder(join(home, "uploads"), agent.uid, group, kind.mode);
  const safe = basename(name).replace(/[^\w.\- ]/g, "_").slice(-100) || "file";
  const path = `uploads/${randomBytes(4).toString("hex")}-${safe}`;
  await newFile(join(home, path), data, agent.uid, group, kind.file);
  return path;
}

export async function uploadedFiles(agent, files = []) {
  for (const path of list(files)) {
    if (typeof path !== "string" || !UPLOADED.test(path)) throw fail(400, "The attachments are not valid");
    if (!(await lstat(join(homeOf(agent), path)).catch(() => null))?.isFile()) throw fail(400, `${path} was not uploaded`);
  }
  return files;
}
