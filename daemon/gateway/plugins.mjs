import { MCP, readJson } from "../common.mjs";
import { PLUGIN_UID_OFFSET, PORT, SYSTEM_PATH } from "../config.mjs";
import { homeOf, isIsolated } from "../agents/agents.mjs";
import { piDirOf } from "../agents/pidir.mjs";
import { spawnSandboxed } from "../sandbox/client.mjs";
import { PLUGINS, sharedTools, spawnAs } from "../users.mjs";
import { forward, headersOf } from "./forward.mjs";

export const servers = async () => (await readJson(MCP)).mcpServers ?? {};

export async function piPlugins(names, key, agent) {
  const all = await servers();
  const mine = {};
  for (const name of names.filter((n) => Object.hasOwn(all, n))) {
    const { url, headers: _headers, command: _command, args: _args, env: _env, ...rest } = all[name];
    mine[name] = url
      ? { ...rest, url: `http://127.0.0.1:${PORT}/api/plugin-proxy/${name}`, headers: { Authorization: `Bearer ${key}` } }
      : { ...rest, command: "node", args: ["/app/gateway/pipe.mjs", name], env: { WEILO_API: `http://127.0.0.1:${PORT}/api`, WEILO_AGENT: agent, WEILO_KEY: key } };
  }
  return { mcpServers: mine };
}

export const pluginOf = async (name) => (await servers())[name];

export async function proxyPlugin(req, res, { plugin, rest, search }) {
  const target = new URL(plugin.url.replace(/\/$/, "") + rest + search);
  await forward(req, res, target, { ...headersOf(req, ["authorization"]), ...plugin.headers });
}

export const PLUGINS_HOME = piDirOf("plugins");

function startPlugin(plugin, agent) {
  const argv = [plugin.command, ...(plugin.args ?? [])];
  if (!isIsolated(agent)) {
    return spawnAs(PLUGINS, argv[0], argv.slice(1), { cwd: PLUGINS_HOME, env: { ...sharedTools, HOME: PLUGINS_HOME, WEILO_FOLDER: homeOf(agent), ...plugin.env }, stdio: ["pipe", "pipe", "ignore"] });
  }
  const uid = agent.uid + PLUGIN_UID_OFFSET;
  const env = { PATH: SYSTEM_PATH, HOME: "/tmp", WEILO_FOLDER: homeOf(agent), ...plugin.env };
  return spawnSandboxed({ user: { uid, gid: uid, groups: [agent.uid] }, argv, cwd: "/tmp", env, umask: 0o002, binds: [{ path: homeOf(agent) }], files: {} });
}

export function pipePlugin(socket, plugin, agent) {
  const child = startPlugin(plugin, agent);
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: weilo-pipe\r\nConnection: Upgrade\r\n\r\n");
  const end = () => (child.kill(), socket.destroy());
  child.on("error", end);
  child.on("exit", () => socket.end());
  socket.on("error", end);
  socket.on("close", end);
  socket.pipe(child.stdin).on("error", () => {});
  child.stdout.pipe(socket);
}
