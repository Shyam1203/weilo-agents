import { request as http } from "node:http";
import { request as https } from "node:https";
import { MCP, readJson, RUN } from "../common.mjs";
import { PORT } from "../config.mjs";
import { homeOf, isIsolated, userOf } from "../agents/agents.mjs";
import { ownTools, PLUGINS, sharedTools, spawnAs } from "../users.mjs";

// The plugins' secrets stay here too. An agent's pi gets only the plugins its agent uses (pidir.mjs), each pointing here:
// - one on the web: this daemon's address and the agent's key; the daemon swaps the key for the plugin's token.
// - one that runs as a program: `node /app/gateway/pipe.mjs <name>`, a pipe to the daemon, which starts the program as the
//   plugins' user, with its secrets, and passes its input and output through. The agent never sees the program's
//   environment; the program reads and writes the workspace, from the agent's folder, as the agent would. An isolated
//   agent's runs as that agent instead, at home in its folder, with no more access than the agent has.

const servers = async () => (await readJson(MCP)).mcpServers ?? {};

// The mcp.json an agent's pi gets.
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

// The plugin, if it exists.
export const pluginOf = async (name) => (await servers())[name];

const HOP = new Set(["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer", "cookie", "authorization"]);

// Passes a request to a plugin on the web, with its own headers (its token) instead of the agent's key.
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

// A pipe from an agent's pi to a plugin that runs as a program, in the agent's folder. The socket is the upgraded
// connection; the program lives as long as it does.
export function pipePlugin(socket, plugin, agent) {
  const cwd = homeOf(agent);
  const [user, env] = isIsolated(agent) ? [userOf(agent), { ...ownTools(cwd), HOME: cwd }] : [PLUGINS, { ...sharedTools, HOME: `${RUN}/pi/plugins` }];
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
