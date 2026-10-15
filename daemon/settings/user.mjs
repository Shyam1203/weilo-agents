import { access, readFile, rm } from "node:fs/promises";
import { fail, USER, writePrivate } from "../common.mjs";
import { MAX_ABOUT, MAX_NAME } from "../config.mjs";
import { shareWithAgents } from "../users.mjs";

export async function getUser() {
  const text = await readFile(USER, "utf8").catch(() => "");
  return { name: /^Name: (.*)$/m.exec(text)?.[1].trim() ?? "", about: text.replace(/^# .*\n/, "").replace(/^Name: .*\n?/m, "").trim() };
}

export async function saveUser({ name = "", about = "" }) {
  if (typeof name !== "string" || typeof about !== "string" || name.length > MAX_NAME || about.length > MAX_ABOUT) throw fail(400, "The details are not valid");
  const user = { name: name.replace(/\s+/g, " ").trim(), about: about.trim() };
  if (!user.name && !user.about) await rm(USER, { force: true });
  else await writePrivate(USER, `# About the user\nName: ${user.name}\n\n${user.about}\n`).then(() => shareWithAgents(USER));
  return user;
}

export const userFlags = async () => ((await access(USER).then(() => true, () => false)) ? ["--append-system-prompt", USER] : []);
