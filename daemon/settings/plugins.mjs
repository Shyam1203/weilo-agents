import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fail, MCP, updateJson } from "../common.mjs";
import { servers } from "../gateway/plugins.mjs";
import { BIN, PLUGIN_STATUS_TIMEOUT_MS } from "../config.mjs";
import { pluginUser, setOwner, sharedTools, spawnAs } from "../users.mjs";

const NAME = /^[\w-]+$/;
const ENV_KEY = /^[A-Za-z_]\w*$/;

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
    const others = { ...mcpServers };
    delete others[name];
    return { ...rest, mcpServers: others };
  });
}

async function report(name, plugin) {
  const { user, home } = await pluginUser(name);
  await writeFile(join(home, "mcp.json"), JSON.stringify({ mcpServers: { [name]: plugin } }), { mode: 0o600 });
  await setOwner(join(home, "mcp.json"), user.uid, user.gid, 0o600);
  const stdout = await new Promise((resolve) => {
    const child = spawnAs(user, BIN.pi, ["mcp", "list", "--json"], { cwd: home, env: { ...process.env, ...sharedTools, PI_CODING_AGENT_DIR: home, HOME: home }, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => child.kill(), PLUGIN_STATUS_TIMEOUT_MS);
    child.stdout.setEncoding("utf8").on("data", (d) => (out += d));
    child.on("error", () => resolve(""));
    child.on("close", () => (clearTimeout(timer), resolve(out)));
  });
  try {
    return JSON.parse(stdout).servers.map((s) => [s.name, { state: s.state, error: s.error, tools: s.tools.length }]);
  } catch {
    return [[name, { state: "failed", error: "Cannot check this plugin", tools: 0 }]];
  }
}

export const pluginStatus = async () => Object.fromEntries((await Promise.all(Object.entries(await servers()).map(([name, plugin]) => report(name, plugin)))).flat());

const toolsOf = (name) => `mcp__${name.replace(/\W/g, "_")}__*`;

export async function pluginTools(names) {
  const have = await servers();
  return names.filter((name) => Object.hasOwn(have, name)).map(toolsOf);
}
