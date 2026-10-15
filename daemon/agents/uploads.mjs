import { randomBytes } from "node:crypto";
import { basename, join } from "node:path";
import { fail } from "../common.mjs";
import { AGENTS_GID } from "../config.mjs";
import { folder, newFile } from "../users.mjs";
import { homeOf } from "./agents.mjs";

// What a message carries besides text. Images go to the model as they are; other files are
// saved in the agent's folder and the message names where.
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

// [{ name, data: base64 }] to files in uploads/ of the agent's folder; returns their paths from there. All are checked
// before any is saved. They are the agent's, shared with the group as its folder is (an isolated agent, not in the group,
// could not open them otherwise).
export async function saveFiles(agent, files = []) {
  for (const file of list(files)) {
    if (typeof file?.name !== "string" || typeof file.data !== "string") throw fail(400, "The attachments are not valid");
  }
  if (!files.length) return [];
  const home = homeOf(agent);
  await folder(join(home, "uploads"), agent.uid, AGENTS_GID, 0o2770);
  return Promise.all(
    files.map(async ({ name, data }) => {
      const safe = basename(name).replace(/[^\w.\- ]/g, "_").slice(-100) || "file";
      const path = `uploads/${randomBytes(4).toString("hex")}-${safe}`;
      await newFile(join(home, path), Buffer.from(data, "base64"), agent.uid, AGENTS_GID, 0o660);
      return path;
    }),
  );
}
