import { request as http } from "node:http";
import { request as https } from "node:https";
import { MCP, readJson, RUN } from "../common.mjs";
import { PORT } from "../config.mjs";
import { homeOf, isIsolated, isolatedGroups, profiles, userOf } from "../agents/agents.mjs";
import { ownTools, PLUGINS, sharedTools, spawnAs } from "../users.mjs";

const servers = async () => (await readJson(MCP)).mcpServers ?? {};

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

const HOP = new Set(["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer", "cookie", "authorization"]);

export async function proxyPlugin(req, res, { plugin, rest, search }) {
  const target = new URL(plugin.url.replace(/\/$/, "") + rest + search);
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) if (!HOP.has(name)) headers[name] = value;
  Object.assign(headers, plugin.headers ?? {});
  await new Promise((resolve, reject) => {
    const upstream = (target.protocol === "https:" ? https : http)(target, { method: req.method, headers }, (answer) => {
      res.writeHead(answer.statusCode, Object.fromEntries(Object.entries(answer.headers).filter(([name]) => !HOP.has(name))));
      answer.pipe(res);
      answer.on("end", resolve);
      answer.on("error", reject);
    });
    upstream.on("error", reject);
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });
}

export async function pipePlugin(socket, plugin, agent) {
  const cwd = homeOf(agent);
  const plugins = { ...PLUGINS, groups: [...PLUGINS.groups, ...isolatedGroups(await profiles())] };
  const [user, env] = isIsolated(agent) ? [userOf(agent), { ...ownTools(cwd), HOME: cwd }] : [plugins, { ...sharedTools, HOME: `${RUN}/pi/plugins` }];
  const child = spawnAs(user, plugin.command, plugin.args ?? [], { cwd, env: { ...env, ...plugin.env }, stdio: ["pipe", "pipe", "ignore"] });
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: weilo-pipe\r\nConnection: Upgrade\r\n\r\n");
  const end = () => (child.kill(), socket.destroy());
  child.on("error", end);
  child.on("exit", () => socket.end());
  socket.on("error", end);
  socket.on("close", end);
  socket.pipe(child.stdin).on("error", () => {});
  child.stdout.pipe(socket);
}
