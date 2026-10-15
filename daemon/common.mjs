import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = process.env.WEILO_ROOT ?? "/home/node/.pi";
export const AGENT_DIR = join(ROOT, "agent");

export const WORKSPACE = join(ROOT, "workspace");
export const SCRATCH = "/tmp/weilo";
export const HOMES = join(ROOT, "homes");
export const ISOLATED = join(ROOT, "isolated");
export const ISOLATED_SESSIONS = join(ROOT, "isolated-sessions");
export const ISOLATED_HOMES = join(ROOT, "isolated-homes");
export const RUN = "/var/lib/weilo";
export const TOOLS = "/home/node/.local";
export const PLUGINS_HOME = join(RUN, "pi", "plugins");
export const PLUGINS_CWD = join(RUN, "pi", "plugins-cwd");
export const PI_ENV = { PI_CODING_AGENT_DIR: AGENT_DIR };
export const AUTH = join(AGENT_DIR, "auth.json");
export const SETTINGS = join(AGENT_DIR, "settings.json");
export const SESSIONS = join(AGENT_DIR, "sessions");
export const CHATS = [SESSIONS, ISOLATED_SESSIONS];
export const PROFILES = join(AGENT_DIR, "profiles");
export const ORDER = join(AGENT_DIR, "order.json");
export const SKILLS = join(AGENT_DIR, "skills");
export const EXTENSIONS = join(AGENT_DIR, "extensions");
export const BUNDLED = Object.fromEntries(["browser", "routines"].map((id) => [id, fileURLToPath(new URL(`./${id}/extension`, import.meta.url))]));
export const MCP = join(AGENT_DIR, "mcp.json");
export const USER = join(AGENT_DIR, "USER.md");
export const MEMORY = join(AGENT_DIR, "MEMORY.md");
export const KNOWLEDGE = join(ROOT, "knowledge");
export const APP = join(ROOT, "weilo.json");
export const CURATOR = join(AGENT_DIR, "curator.json");
export const ROUTINES = join(AGENT_DIR, "routines.json");
export const BROWSER = join(AGENT_DIR, "browser.json");
export const PUSH = join(AGENT_DIR, "push.json");
export const MODELS = join(AGENT_DIR, "models.json");
export const INSTALL = join(AGENT_DIR, "install.json");
export const DEVICES = join(AGENT_DIR, "devices.json");
export const AUDIT = join(AGENT_DIR, "audit.jsonl");
export const USAGE = join(AGENT_DIR, "usage.json");

const SECRET =
  /\b(sk-[\w-]{16,}|gh[pousr]_\w{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[\w-]{10,}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})|-----BEGIN [A-Z ]*PRIVATE KEY|\b(?:\d[ -]?){13,19}\b|\b(password|passwd|api[ _-]?key|secret|token)\s*[:=]/i;

const STEERING =
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(instructions?|rules|prompt|guidelines)\b|\b(system prompt|developer message|you are now|new instructions|do not tell the user|don't tell the user)\b|<\/?(system|instructions?|assistant)>|\b(curl|wget)\b[^\n]*\|\s*(ba|z)?sh\b|authorized_keys|\bbase64\s+(-d|--decode)\b[^\n]*\|/i;
const INVISIBLE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/u;
export const unsafe = (text) => (SECRET.test(text) ? "secret" : STEERING.test(text) || INVISIBLE.test(text) ? "steering" : null);

export const plainText = (markdown) =>
  markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/^\s*\|?(\s*:?-{3,}:?\s*\|?)+\s*$/gm, "")
    .replace(/\*\*|__|~~|`|\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const fail = (status, message) => Object.assign(new Error(message), { status });

export const slug = (text, max) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, max).replace(/^-|-$/g, "");

export async function writePrivate(file, text) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, text, { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}

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

const chains = new Map();
export function updateJson(file, change) {
  const run = (chains.get(file) ?? Promise.resolve()).then(async () => {
    const data = await change(await readJson(file));
    await writePrivate(file, JSON.stringify(data, null, 2));
    return data;
  });
  const tail = run.catch(() => {});
  chains.set(file, tail);
  void tail.then(() => chains.get(file) === tail && chains.delete(file));
  return run;
}
