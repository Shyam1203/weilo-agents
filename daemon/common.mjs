import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// pi's data folder: the host's ~/.weilo-agents, mounted here.
const ROOT = "/home/node/.pi";
const AGENT_DIR = join(ROOT, "agent");

// Where every pi runs, the environment that points it at the shared config, and what lives there.
export const WORKSPACE = join(ROOT, "workspace");
export const PI_ENV = { PI_CODING_AGENT_DIR: AGENT_DIR };
export const AUTH = join(AGENT_DIR, "auth.json");
export const SETTINGS = join(AGENT_DIR, "settings.json");
export const SESSIONS = join(AGENT_DIR, "sessions");
export const PROFILES = join(AGENT_DIR, "profiles");
export const ORDER = join(AGENT_DIR, "order.json");
export const SKILLS = join(AGENT_DIR, "skills");
export const EXTENSIONS = join(AGENT_DIR, "extensions");
// The extensions that come with the app: the `extension/` folder of each feature that has one, next to its code. (Memory's is not one of them: every agent has it.)
export const BUNDLED = Object.fromEntries(["browser", "routines"].map((id) => [id, fileURLToPath(new URL(`./${id}/extension`, import.meta.url))]));
export const MCP = join(AGENT_DIR, "mcp.json");
export const USER = join(AGENT_DIR, "USER.md");
export const MEMORY = join(AGENT_DIR, "MEMORY.md");
// The knowledge vault the curator keeps (folders of markdown pages), beside agent/ and workspace/.
export const KNOWLEDGE = join(ROOT, "knowledge");
// Which app and data version last used the data folder (migrate.mjs).
export const APP = join(ROOT, "weilo.json");
export const CURATOR = join(AGENT_DIR, "curator.json");
export const ROUTINES = join(AGENT_DIR, "routines.json");
export const BROWSER = join(AGENT_DIR, "browser.json");
export const PUSH = join(AGENT_DIR, "push.json");
// pi's model settings, and this installation's id (some providers' sign-in names the device).
export const MODELS = join(AGENT_DIR, "models.json");
export const INSTALL = join(AGENT_DIR, "install.json");

// Keys, tokens, passwords and card numbers are never saved, in a note or in a page of the vault. A false alarm costs a retry (a note) or replaces the line (a page).
export const SECRET =
  /\b(sk-[\w-]{16,}|gh[pousr]_\w{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[\w-]{10,}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})|-----BEGIN [A-Z ]*PRIVATE KEY|\b(?:\d[ -]?){13,19}\b|\b(password|passwd|api[ _-]?key|secret|token)\s*[:=]/i;

// Markdown as plain text on one line (a notification, a search result): no heading, list, bold, code or table marks; a link as its text.
export const plainText = (markdown) =>
  markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/^\s*\|?(\s*:?-{3,}:?\s*\|?)+\s*$/gm, "")
    .replace(/\*\*|__|~~|`|\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// An error the server can show: a message and an HTTP status.
export const fail = (status, message) => Object.assign(new Error(message), { status });

// A name for a file or folder: lowercase letters, digits and hyphens.
export const slug = (text, max) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, max).replace(/^-|-$/g, "");

// A file private to the user, written whole or not at all: a crash never leaves half of it.
export async function writePrivate(file, text) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, text, { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}

// pi's own JSON files, private to the user. A missing file is empty; a corrupt one throws, so it
// is never overwritten (and its contents, which may hold keys, never reach the log).
export async function readJson(file) {
  const text = await readFile(file, "utf8").catch((err) => {
    if (err.code === "ENOENT") return "{}";
    throw err;
  });
  try {
    return JSON.parse(text);
  } catch {
    throw fail(500, `${basename(file)} is not valid JSON`);
  }
}

// Changes to one file happen one after another, each from the file as the one before left it, so
// two at once never share the temporary file or lose each other's change. `change` gets the file's
// contents and returns the new ones.
const chains = new Map();
export function updateJson(file, change) {
  const run = (chains.get(file) ?? Promise.resolve()).then(async () => {
    const data = await change(await readJson(file));
    await writePrivate(file, JSON.stringify(data, null, 2));
    return data;
  });
  const tail = run.catch(() => {});
  chains.set(file, tail);
  // The last change of a file takes its chain with it: one entry per agent ever made would stay.
  void tail.then(() => chains.get(file) === tail && chains.delete(file));
  return run;
}
