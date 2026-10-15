import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { piDirOf } from "../agents/pidir.mjs";
import { fail, MCP, readJson, updateJson, WORKSPACE } from "../common.mjs";
import { BIN, PLUGIN_STATUS_TIMEOUT_MS } from "../config.mjs";
import { folder, PLUGINS, setOwner, sharedTools, spawnAs } from "../users.mjs";

const NAME = /^[\w-]+$/;
const ENV_KEY = /^[A-Za-z_]\w*$/;

const servers = async () => (await readJson(MCP)).mcpServers ?? {};

const words = (line) => [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);

export async function listPlugins() {
  const all = await servers();
  return Object.entries(all).map(([name, s]) => ({ name, detail: s.url ?? [s.command, ...(s.args ?? [])].join(" ") }));
}

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

async function report() {
  const dir = piDirOf("plugins");
  await folder(dir, PLUGINS.uid, PLUGINS.gid, 0o700);
  await writeFile(join(dir, "mcp.json"), JSON.stringify(await readJson(MCP)), { mode: 0o600 });
  await setOwner(join(dir, "mcp.json"), PLUGINS.uid, PLUGINS.gid, 0o600);
  return new Promise((resolve) => {
    const child = spawnAs(PLUGINS, BIN.pi, ["mcp", "list", "--json"], { cwd: WORKSPACE, env: { ...process.env, ...sharedTools, PI_CODING_AGENT_DIR: dir, HOME: dir }, stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    const timer = setTimeout(() => child.kill(), PLUGIN_STATUS_TIMEOUT_MS);
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.on("error", () => resolve(""));
    child.on("close", () => (clearTimeout(timer), resolve(stdout)));
  });
}

export async function pluginStatus() {
  const stdout = await report();
  try {
    return Object.fromEntries(JSON.parse(stdout).servers.map((s) => [s.name, { state: s.state, error: s.error, tools: s.tools.length }]));
  } catch {
    throw fail(502, "Cannot check the plugins");
  }
}

const toolsOf = (name) => `mcp__${name.replace(/\W/g, "_")}__*`;

export async function pluginTools(names) {
  const have = await servers();
  return names.filter((name) => Object.hasOwn(have, name)).map(toolsOf);
}
