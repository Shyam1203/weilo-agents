import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fail, MCP, PI_ENV, readJson, updateJson, WORKSPACE } from "../common.mjs";
import { PLUGIN_STATUS_TIMEOUT_MS } from "../config.mjs";

// Plugins are MCP servers, pi's own: agent/mcp.json { "mcpServers": { "<name>": { command, args, env } or { url, headers } } }.
// Which agent uses which is the agent's profile; this only keeps the list. Secrets (env, token)
// are only ever written here, never returned.

const run = promisify(execFile);
const NAME = /^[\w-]+$/;
const ENV_KEY = /^[A-Za-z_]\w*$/;

const servers = async () => (await readJson(MCP)).mcpServers ?? {};

// "npx -y server 'my folder'" to ["npx", "-y", "server", "my folder"].
const words = (line) => [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);

export async function listPlugins() {
  const all = await servers();
  return Object.entries(all).map(([name, s]) => ({ name, detail: s.url ?? [s.command, ...(s.args ?? [])].join(" ") }));
}

// Adds a plugin that runs a `command`, or reaches a web address `url` (with an access `token`).
export async function addPlugin({ name, command, url, env = {}, token }) {
  if (typeof name !== "string" || !NAME.test(name)) throw fail(400, "Use only letters, numbers, - and _ in the name");
  let entry;
  if (typeof command === "string" && command.trim()) {
    const [program, ...args] = words(command);
    if (!env || typeof env !== "object" || !Object.entries(env).every(([k, v]) => ENV_KEY.test(k) && typeof v === "string")) throw fail(400, "The variables are not valid");
    entry = { command: program, args, ...(Object.keys(env).length && { env }) };
  } else if (typeof url === "string" && /^https?:\/\//.test(url.trim())) {
    entry = { url: url.trim(), ...(typeof token === "string" && token.trim() && { headers: { Authorization: `Bearer ${token.trim()}` } }) };
  } else {
    throw fail(400, "Type a command or a web address");
  }
  await updateJson(MCP, ({ mcpServers = {}, ...rest }) => {
    if (Object.hasOwn(mcpServers, name)) throw fail(409, "A plugin with that name already exists");
    return { ...rest, mcpServers: { ...mcpServers, [name]: entry } };
  });
}

export async function removePlugin(name) {
  if (!NAME.test(name)) throw fail(404, "This plugin does not exist");
  await updateJson(MCP, ({ mcpServers = {}, ...rest }) => {
    const { [name]: _removed, ...others } = mcpServers;
    return { ...rest, mcpServers: others };
  });
}

// Whether each plugin connects, by asking pi: { name: { state, error?, tools } }. Takes a few seconds.
export async function pluginStatus() {
  // pi exits 1 when a server fails; its report is still on stdout.
  const { stdout } = await run("pi", ["mcp", "list", "--json"], { cwd: WORKSPACE, env: { ...process.env, ...PI_ENV }, timeout: PLUGIN_STATUS_TIMEOUT_MS }).catch((err) => err);
  try {
    return Object.fromEntries(JSON.parse(stdout).servers.map((s) => [s.name, { state: s.state, error: s.error, tools: s.tools.length }]));
  } catch {
    throw fail(502, "Cannot check the plugins");
  }
}

// pi's name for a plugin's tools: mcp__<name>__<tool>, with anything but letters, digits and _ turned into _.
const toolsOf = (name) => `mcp__${name.replace(/\W/g, "_")}__*`;

// What these plugins, the ones that exist, allow pi to call, for its `--tools`.
export async function pluginTools(names) {
  const have = await servers();
  return names.filter((name) => Object.hasOwn(have, name)).map(toolsOf);
}
