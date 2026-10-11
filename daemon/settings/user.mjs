import { access, readFile, rm } from "node:fs/promises";
import { fail, USER, writePrivate } from "../common.mjs";
import { MAX_ABOUT, MAX_NAME } from "../config.mjs";

// What the agents know about you: agent/USER.md, which pi adds to every agent's system prompt.
// The file is "Name: <name>", a blank line, then what else you wrote. You can edit it by hand.

export async function getUser() {
  const text = await readFile(USER, "utf8").catch(() => "");
  return { name: /^Name: (.*)$/m.exec(text)?.[1].trim() ?? "", about: text.replace(/^# .*\n/, "").replace(/^Name: .*\n?/m, "").trim() };
}

// With no name and nothing written, the file goes and agents hear nothing about you.
export async function saveUser({ name = "", about = "" }) {
  if (typeof name !== "string" || typeof about !== "string" || name.length > MAX_NAME || about.length > MAX_ABOUT) throw fail(400, "The details are not valid");
  const user = { name: name.replace(/\s+/g, " ").trim(), about: about.trim() };
  if (!user.name && !user.about) await rm(USER, { force: true });
  else await writePrivate(USER, `# About the user\nName: ${user.name}\n\n${user.about}\n`);
  return user;
}

// Pi's command line adds the file only when it exists: a path that is not a file would become prompt text.
export const userFlags = async () => ((await access(USER).then(() => true, () => false)) ? ["--append-system-prompt", USER] : []);
