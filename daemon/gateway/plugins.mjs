import { MCP, PLUGINS_CWD, readJson } from "../common.mjs";
import { PLUGIN_UID_OFFSET, PORT, SYSTEM_PATH } from "../config.mjs";
import { homeOf, isIsolated } from "../agents/agents.mjs";
import { spawnSandboxed } from "../sandbox/client.mjs";
import { pluginUser, sharedTools, spawnAs } from "../users.mjs";
import { forward, headersOf } from "./forward.mjs";
import { accessToken } from "../settings/oauth.mjs";

export const servers = async () => (await readJson(MCP)).mcpServers ?? {};

export async function piPlugins(names, key, agent) {
  const all = await servers();
  const mine = {};
  for (const name of names.filter((n) => Object.hasOwn(all, n))) {
    const { url, headers: _headers, command: _command, args: _args, env: _env, oauth: _oauth, ...rest } = all[name];
    mine[name] = url
      ? { ...rest, url: `http://127.0.0.1:${PORT}/api/plugin-proxy/${name}`, headers: { Authorization: `Bearer ${key}` } }
      : { ...rest, command: "node", args: ["/app/gateway/pipe.mjs", name], env: { WEILO_API: `http://127.0.0.1:${PORT}/api`, WEILO_AGENT: agent, WEILO_KEY: key } };
  }
  return { mcpServers: mine };
}

export const pluginOf = async (name) => (await servers())[name];

export async function proxyPlugin(req, res, { name, plugin, rest, search }) {
  const target = new URL(plugin.url.replace(/\/$/, "") + rest + search);
  const token = await accessToken(name, plugin);
  await forward(req, res, target, { ...headersOf(req, ["authorization"]), ...(token ? { authorization: `Bearer ${token}` } : plugin.headers) });
}


async function startPlugin(name, plugin, agent) {
  const argv = [plugin.command, ...(plugin.args ?? [])];
  if (!isIsolated(agent)) {
    const { user, home } = await pluginUser(name);
    return spawnAs(user, argv[0], argv.slice(1), { cwd: PLUGINS_CWD, env: { ...sharedTools, HOME: home, WEILO_FOLDER: homeOf(agent), ...plugin.env }, stdio: ["pipe", "pipe", "ignore"] });
  }
  const uid = agent.uid + PLUGIN_UID_OFFSET;
  const env = { PATH: SYSTEM_PATH, HOME: "/tmp", WEILO_FOLDER: homeOf(agent), ...plugin.env };
  return spawnSandboxed({ user: { uid, gid: uid, groups: [agent.uid] }, argv, cwd: "/tmp", env, umask: 0o002, binds: [{ path: homeOf(agent) }], files: {} });
}

export async function pipePlugin(socket, name, plugin, agent) {
  const child = await startPlugin(name, plugin, agent);
  if (socket.destroyed) return void child.kill();
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: weilo-pipe\r\nConnection: Upgrade\r\n\r\n");
  const end = () => (child.kill(), socket.destroy());
  child.on("error", end);
  child.on("exit", () => socket.end());
  socket.on("error", end);
  socket.on("close", end);
  socket.pipe(child.stdin).on("error", () => {});
  child.stdout.pipe(socket);
  child.stderr?.resume();
}
