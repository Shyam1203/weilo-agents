import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createSocketServer } from "node:net";
import { dirname } from "node:path";
import { createAgent, filesOf, getAgent, isIsolated, mayCall, profiles, listAgents, removeFiles, removeProfile, setOrder, updateAgent } from "./agents/agents.mjs";
import { abort, activityOf, answer, compact, contextOf, holding, prompt, restart, restartAll, skillCommands, stop, stopAll, unqueue } from "./agents/runner.mjs";
import { askAgent, manageAgents } from "./agents/manage.mjs";
import { forgetKeys, keyTool, listKeys, removeKey as removeAgentKey } from "./agents/keys.mjs";
import { ALLOWED_NOTE, approve } from "./agents/approve.mjs";
import { searchChats } from "./agents/search.mjs";
import { backfillUsage, usageHistory, usageSaved, usageToday } from "./agents/usage.mjs";
import { earlierOf } from "./agents/sessions.mjs";
import { serveImage } from "./agents/images.mjs";
import { agentsChanged } from "./agents/status.mjs";
import { saveUpload } from "./agents/uploads.mjs";
import { clearScratch } from "./agents/workspace.mjs";
import { closeBrowser, finishTeaching, giveBack, hasWindow, isTaken, showBrowser, startTeaching, takeOver, teachingSteps, useBrowser, windowOpen } from "./browser/browser.mjs";
import { cdpUpgrade, isCdpPath, viewUpgrade } from "./browser/screen.mjs";
import { fail, settled } from "./common.mjs";
import { ADMIN_SOCKET, MAX_UPLOAD, PORT, SANDBOX_API, SANDBOX_DIR, HUNG_MS, MAX_PAIR_BODY, SHUTDOWN_MS, SYSTEM_PATH, USAGE_SHOWN, ACTIVITY_SHOWN } from "./config.mjs";
import { sendContact } from "./contact.mjs";
import { providerOf, proxyModel, warmModels } from "./gateway/models.mjs";
import { pipePlugin, pluginOf, proxyPlugin } from "./gateway/plugins.mjs";
import { cookieFor, identify, keyIn, newCode, pair, pairedDevices, unpair } from "./http/access.mjs";
import { agentStatus, events } from "./http/events.mjs";
import { serveFile } from "./http/files.mjs";
import { bodyOf, guard, rawBodyOf, reply } from "./http/request.mjs";
import { serveUi } from "./http/static.mjs";
import { CURATOR_KEY, getCurator, setCurator, startCurator } from "./memory/curator.mjs";
import { summarize } from "./agents/summary.mjs";
import { fetchKnowledge } from "./memory/fetch.mjs";
import { useMemory } from "./memory/memory.mjs";
import { migrate } from "./migrate.mjs";
import { addDevice, markSeen, notifiedDevices, pushStatus, removeDevice, removePaired, setMuted } from "./push.mjs";
import { actionTool, addAction, changeAction, forgetActions, listActions, noteZone, removeAction, runAction, startActions } from "./actions/actions.mjs";
import { forgetPins, listPins, pinTool, removePin, tickPin } from "./actions/pins.mjs";
import { addExtension, listExtensions, removeExtension } from "./settings/extensions.mjs";
import { answerSignIn, signInStatus, startSignIn, stopSignIn } from "./settings/login.mjs";
import { addPlugin, listPlugins, pluginStatus, removePlugin } from "./settings/plugins.mjs";
import { CALLBACK, finishSignIn, signOut, startSignIn as startPluginSignIn } from "./settings/oauth.mjs";
import { listModels, listProviders, removeKey, saveKey, setEnabledModels, syncCompaction } from "./settings/providers.mjs";
import { addSkills, hasSkill, listSkills, planSkill, removeSkill, saveSkill } from "./settings/skills.mjs";
import { manageSettings } from "./settings/manage.mjs";
import { getUser, saveUser } from "./settings/user.mjs";
import { setUpdateCheck, updateStatus } from "./update.mjs";
import { audit, audited, recentAudit } from "./audit.mjs";
import { syncIndex } from "./agents/chats.mjs";
import { watchdog } from "./watchdog.mjs";
import { secure } from "./users.mjs";
import { BUILD } from "./version.mjs";

process.umask(0o007);
process.env.PATH = SYSTEM_PATH;
delete process.env.npm_config_prefix;
delete process.env.PYTHONUSERBASE;

const routes = [];
const route = (method, path, handler, { tool = null, audited = method !== "GET", stream = false } = {}) =>
  routes.push({ method, path, handler, tool, audited, stream, scoped: path.startsWith("/api/agents/:id"), pattern: new RegExp(`^${path.replace(":id", "(?<id>[^/]+)").replace(":rid", "(?<rid>[^/]+)").replace("*", "(?<rest>.+)")}$`) });
const agentRoute = (method, path, tool, handler, options = {}) => route(method, path, handler, { tool, ...options });
const quiet = { audited: false };
const streamed = { audited: false, stream: true };
const SAVE = "Save it";

const forAll = (change) => async (req) => {
  const result = await change(req);
  await restartAll();
  return result;
};

route("GET", "/api/version", () => BUILD);
route("GET", "/api/activity", () => recentAudit(ACTIVITY_SHOWN));
route("GET", "/api/usage", () => usageHistory(USAGE_SHOWN));
route("GET", "/api/devices", async ({ who }) => {
  const [devices, notified] = await Promise.all([pairedDevices(who.device), notifiedDevices()]);
  return devices.map((d) => ({ ...d, notifications: notified.has(d.id) }));
});
route("POST", "/api/devices/code", () => newCode());
route("DELETE", "/api/devices/:id", async ({ id }) => (await unpair(id), await removePaired(id), undefined));
route("GET", "/api/update", () => updateStatus());
route("PUT", "/api/update", ({ body }) => setUpdateCheck(body));
route("POST", "/api/contact", ({ body }) => sendContact(body));
route("GET", "/api/providers", () => listProviders());
route("PUT", "/api/providers/:id", forAll(({ id, body }) => saveKey(id, body.key)));
route("DELETE", "/api/providers/:id", forAll(({ id }) => removeKey(id)));
route("POST", "/api/providers/:id/sign-in", ({ id }) => startSignIn(id));
route("GET", "/api/providers/:id/sign-in", ({ id }) => signInStatus(id));
route("PUT", "/api/providers/:id/sign-in", ({ id, body }) => answerSignIn(id, body.answer));
route("DELETE", "/api/providers/:id/sign-in", ({ id }) => stopSignIn(id));
route("GET", "/api/models", () => listModels());
route("PUT", "/api/models", ({ body }) => setEnabledModels(body.enabled));
route("GET", "/api/plugins", () => listPlugins());
route("GET", "/api/plugins/status", () => pluginStatus());
route("POST", "/api/plugins", ({ body }) => addPlugin(body));
route("DELETE", "/api/plugins/:id", forAll(({ id }) => removePlugin(id)));
route("POST", "/api/plugins/:id/sign-in", ({ id, body, headers }) => {
  if (typeof body.origin !== "string" || !/^https?:$/.test(URL.parse(body.origin)?.protocol ?? "") || URL.parse(body.origin)?.host !== headers.host) throw fail(400, "Open the app from its usual address, then sign in again");
  return startPluginSignIn(id, new URL(body.origin).origin);
});
route("DELETE", "/api/plugins/:id/sign-in", forAll(({ id }) => signOut(id)));
route("GET", "/api/skills", () => listSkills());
route("POST", "/api/skills", forAll(({ body }) => addSkills(body)));
route("DELETE", "/api/skills/:id", forAll(({ id }) => removeSkill(id)));
route("GET", "/api/extensions", () => listExtensions());
route("POST", "/api/extensions", forAll(({ body }) => addExtension(body)));
route("DELETE", "/api/extensions/:id", forAll(({ id }) => removeExtension(id)));
route("GET", "/api/user", () => getUser());
route("PUT", "/api/user", forAll(({ body }) => saveUser(body)));
route("GET", "/api/memory", () => getCurator());
route("PUT", "/api/memory", async ({ body }) => {
  const was = await getCurator();
  const now = await setCurator(body);
  if (now.notes !== was.notes) await restartAll();
  return now;
});
route("GET", "/api/push", () => pushStatus());
route("POST", "/api/push/devices", ({ body, who }) => addDevice(body, who.device));
route("DELETE", "/api/push/devices/:id", ({ id }) => removeDevice(id));
route("PUT", "/api/push/muted", ({ body }) => setMuted(body.muted));
route("GET", "/api/search", ({ query }) => searchChats(query.get("q")));
route("GET", "/api/images/:id", ({ id, res }) => serveImage(res, id), streamed);
route("GET", "/api/agents/status", ({ req, res }) => agentStatus(req, res), streamed);
route("GET", "/api/agents/:id/events", ({ id, req, res }) => events(req, res, id), streamed);
route("GET", "/api/agents/:id/files/*", ({ agent, rest, query, res }) => serveFile(res, filesOf(agent), rest, query.has("view")), streamed);
route("POST", "/api/agents/:id/uploads", async ({ agent, query, req, res }) => reply(res, 200, { path: await saveUpload(agent, query.get("name") ?? "", await rawBodyOf(req, MAX_UPLOAD)) }), streamed);
route("GET", "/api/agents", async ({ query }) => {
  if (query.has("seen")) markSeen();
  const [agents, used] = await Promise.all([listAgents(), usageToday()]);
  return agents.map((agent) => ({ ...agent, used: used[agent.id] ?? 0, working: activityOf(agent.id) !== null, doing: activityOf(agent.id), taken: isTaken(agent.id), browserOpen: windowOpen(agent.id) }));
});
route("POST", "/api/agents", ({ body }) => createAgent(body));
route("PUT", "/api/agents", ({ body }) => setOrder(body.order), quiet);
route("PUT", "/api/agents/:id", async ({ id, body }) => {
  const moves = typeof body.isolated === "boolean" && body.isolated !== isIsolated(await getAgent(id));
  const agent = moves ? await holding(id, () => updateAgent(id, body)) : await updateAgent(id, body);
  await restart(id);
  return agent;
});
route("DELETE", "/api/agents/:id", async ({ id, body }) => {
  const agent = await getAgent(id);
  await removeProfile(id);
  await forgetActions(id);
  await forgetPins(id);
  await forgetKeys(id);
  await stop(id);
  await closeBrowser(id);
  await removeFiles(agent, { keepChat: body.keepChat === true, keepFiles: body.keepFiles === true });
});
route("POST", "/api/agents/:id/message", ({ id, body }) => prompt(id, body), quiet);
route("POST", "/api/agents/:id/unqueue", ({ id, body }) => unqueue(id, body), quiet);
route("POST", "/api/agents/:id/abort", ({ id }) => abort(id), quiet);
route("POST", "/api/agents/:id/answer", ({ id, body }) => answer(id, body), quiet);
route("GET", "/api/agents/:id/commands", ({ id }) => skillCommands(id));
route("GET", "/api/agents/:id/context", ({ id }) => contextOf(id));
route("GET", "/api/agents/:id/earlier", ({ id, query }) => earlierOf(id, Math.max(0, Number(query.get("skip")) || 0)));
route("POST", "/api/agents/:id/reload", ({ id }) => restart(id), quiet);
route("POST", "/api/agents/:id/compact", ({ id, body }) => compact(id, body.instructions), quiet);
agentRoute("POST", "/api/agents/:id/browser", "browser", async ({ id, body }) => ({ text: await useBrowser(id, body) }), quiet);
route("GET", "/api/agents/:id/browser", async ({ id }) => ({ taken: isTaken(id), hasWindow: await hasWindow(id), teaching: teachingSteps(id) }));
route("POST", "/api/agents/:id/browser/show", ({ id }) => showBrowser(id), quiet);
route("POST", "/api/agents/:id/browser/take-over", ({ id }) => takeOver(id), quiet);
route("POST", "/api/agents/:id/browser/give-back", ({ id }) => giveBack(id), quiet);
route("POST", "/api/agents/:id/browser/teach", ({ id }) => startTeaching(id));
route("POST", "/api/agents/:id/browser/teach/done", ({ id, body }) => finishTeaching(id, body.goal));
agentRoute("POST", "/api/agents/:id/skill", "skill", async ({ id, body }) => {
  const skill = planSkill(body);
  const agent = await getAgent(id);
  const users = (await profiles()).filter((a) => a.id !== id && a.skills.includes(skill.id)).map((a) => a.name);
  const change = (await hasSkill(skill.id)) ? `change the skill "${skill.id}"${users.length ? ` (also used by ${users.join(", ")})` : ""}` : `save the skill "${skill.id}"`;
  const question = `${agent.name} asks to ${change}: ${skill.about}\n\n${skill.instructions}`;
  const { answer, always } = await approve(id, "skill", question, [SAVE, "Don't"]);
  if (answer !== SAVE) return { text: "The user did not approve it: nothing was saved. Do not ask again unless they ask you to." };
  const folder = await saveSkill(skill);
  await updateAgent(id, (now) => ({ skills: [...new Set([...now.skills, skill.id])] }));
  await restart(id);
  return { text: `Saved the skill "${skill.id}" in ${folder}/ (put any scripts or other files it needs there). It is on for you and loads when this reply ends. It shows under Skills in Settings.`, ...(always && { details: { note: `Saved the skill ${skill.id}${ALLOWED_NOTE}` } }) };
});
agentRoute("POST", "/api/agents/:id/manage_agents", "manage_agents", ({ id, body }) => manageAgents(id, body));
agentRoute("POST", "/api/agents/:id/ask_agent", "ask_agent", ({ id, body }) => askAgent(id, body));
agentRoute("POST", "/api/agents/:id/manage_settings", "manage_settings", ({ id, body }) => manageSettings(id, body));
agentRoute("POST", "/api/agents/:id/memory", "memory", async ({ body }) => {
  if (!(await getCurator()).notes) throw fail(403, "Notes about the user are off in Settings > Memory.");
  return { text: await useMemory(body) };
});
agentRoute("POST", "/api/agents/:id/fetch_knowledge", "fetch_knowledge", async ({ body }) => ({ text: await fetchKnowledge(body) }), quiet);
agentRoute("POST", "/api/agents/:id/action", "action", ({ id, body }) => actionTool(id, body));
route("GET", "/api/agents/:id/actions", async ({ id, headers }) => (await noteZone(headers["x-timezone"]), listActions(id)));
route("POST", "/api/agents/:id/actions", ({ id, body }) => addAction(id, body));
route("PUT", "/api/agents/:id/actions/:rid", ({ id, rid, body }) => changeAction(id, rid, body));
route("POST", "/api/agents/:id/actions/:rid/run", ({ id, rid, body }) => runAction(id, rid, body.input));
route("DELETE", "/api/agents/:id/actions/:rid", ({ id, rid }) => removeAction(id, rid));
agentRoute("POST", "/api/agents/:id/key", "key", ({ id, body }) => keyTool(id, body));
agentRoute("POST", "/api/agents/:id/summary", "summary", ({ id, body }) => summarize(id, body), quiet);
route("GET", "/api/agents/:id/keys", ({ id }) => listKeys(id));
route("DELETE", "/api/agents/:id/keys/:rid", ({ id, rid }) => removeAgentKey(id, rid));
agentRoute("POST", "/api/agents/:id/pin", "pin", ({ id, body }) => pinTool(id, body));
route("GET", "/api/agents/:id/pins", ({ id }) => listPins(id));
route("POST", "/api/agents/:id/pins/:rid/tick", ({ id, rid, body }) => tickPin(id, rid, body));
route("DELETE", "/api/agents/:id/pins/:rid", ({ id, rid }) => removePin(id, rid));

async function callerOf(req, url, sandboxed) {
  const caller = keyIn(req, url.searchParams);
  if (!caller) {
    if (sandboxed) throw fail(403, "Not permitted");
    return null;
  }
  const isolated = caller.agent !== CURATOR_KEY && isIsolated(await getAgent(caller.agent));
  if (isolated !== sandboxed) throw fail(403, "Not permitted");
  return caller;
}

async function handle(req, res, sandboxed) {
  try {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    guard(req, path);
    const caller = await callerOf(req, url, sandboxed);
    if (!sandboxed && path === "/api/health") return reply(res, 200, { ok: true });
    if (!sandboxed && !path.startsWith("/api/")) return await serveUi(req, res);
    const proxied = path.match(/^\/api\/(model|plugin)-proxy\/([\w.-]+)(\/.*)?$/);
    if (proxied) {
      if (!caller) throw fail(401, "Not permitted");
      const [, kind, name, rest = ""] = proxied;
      if (kind === "model") {
        if ((await allowedProvider(caller.agent)) !== name) throw fail(403, "Not permitted");
        return await proxyModel(req, res, { key: caller.key, provider: name, rest, search: url.search });
      }
      const plugin = await allowedPlugin(caller.agent, name);
      if (!plugin.url) throw fail(404, "Not found");
      return await proxyPlugin(req, res, { name, plugin, rest, search: url.search });
    }
    if (path === "/api/pair" && req.method === "POST" && !sandboxed) {
      const token = await pair((await bodyOf(req, MAX_PAIR_BODY)).code, req.headers["user-agent"]).catch((err) => {
        audit("pairing refused", { reason: err.message });
        throw err;
      });
      audit("device paired", { name: req.headers["user-agent"]?.slice(0, 200) });
      res.setHeader("Set-Cookie", cookieFor(token, req.headers.host));
      return reply(res, 204);
    }
    if (path === CALLBACK && req.method === "GET" && !sandboxed) return await signedIn(res, url.searchParams);
    const who = await identify(req);
    if (!who) return reply(res, 401, { error: "Pair this device to use Weilo Agents.", pair: true });
    for (const { method, path: name, pattern, handler, scoped, tool, audited, stream } of routes) {
      const match = req.method === method && path.match(pattern);
      if (!match) continue;
      const { id, rid, rest } = match.groups ?? {};
      if (who.agent && !(tool && id === who.agent)) throw fail(403, "Not permitted");
      if (who.script && tool !== "browser") throw fail(403, "Not permitted");
      const agent = scoped && (await getAgent(id));
      if (who.agent && !mayCall(agent, tool)) throw fail(403, "An isolated agent cannot use this. The user can change what it may use in its settings.");
      const args = { id, rid, rest, agent, query: url.searchParams, headers: req.headers, who };
      if (stream) return await handler({ ...args, req, res });
      const result = await handler({ ...args, body: await bodyOf(req) });
      if (method !== "GET" && name.startsWith("/api/agents") && (who.device || tool === "manage_agents")) agentsChanged();
      if (audited) audit(`${method} ${name}`, { by: who.device ? `device ${who.device}` : `agent ${who.agent}`, ...(id && { id }), ...(rid && { rid }) });
      return result === undefined ? reply(res, 204) : reply(res, 200, result);
    }
    throw fail(404, "Not found");
  } catch (err) {
    if (!err.status) console.error(err);
    if (res.headersSent) return res.destroy();
    reply(res, err.status ?? 500, { error: err.status ? err.message : "An error occurred" });
  }
}

const page = (text) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Weilo Agents</title><body style="font:16px system-ui;margin:3rem auto;max-width:28rem;padding:0 1rem;color-scheme:light dark"><p>${text.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)}</p>`;

async function signedIn(res, query) {
  let text;
  try {
    const name = await finishSignIn(query.get("state") ?? "", query.get("code"), query.get("error"));
    audit("plugin signed in", { plugin: name });
    await restartAll();
    text = `Signed in to ${name}. You can close this tab.`;
  } catch (err) {
    if (!err.status) console.error(err);
    text = err.status ? err.message : "The sign-in did not work. Try again in Settings > Plugins.";
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Referrer-Policy": "no-referrer" });
  res.end(page(text));
}

async function allowedProvider(agent) {
  return providerOf(agent === CURATOR_KEY ? (await getCurator()).model : (await getAgent(agent)).model);
}

async function allowedPlugin(agent, name) {
  const plugin = agent !== CURATOR_KEY && (await getAgent(agent)).plugins.includes(name) && (await pluginOf(name));
  if (!plugin) throw fail(403, "Not permitted");
  return plugin;
}

async function upgrade(req, socket, head, sandboxed) {
  socket.on("error", () => socket.destroy());
  try {
    const url = new URL(req.url, "http://localhost");
    guard(req, url.pathname);
    const caller = await callerOf(req, url, sandboxed);
    if (!sandboxed && url.pathname === "/api/browser/view" && (await identify(req))?.device && viewUpgrade(req, socket, head)) return;
    if (!sandboxed && isCdpPath(url.pathname) && cdpUpgrade(req, socket, head)) return;
    const pipe = url.pathname.match(/^\/api\/plugin-pipe\/([\w-]+)$/);
    if (pipe && caller) {
      const plugin = await allowedPlugin(caller.agent, pipe[1]);
      if (plugin.command) return await pipePlugin(socket, pipe[1], plugin, await getAgent(caller.agent));
    }
  } catch {}
  socket.destroy();
}

const server = createServer((req, res) => handle(req, res, false)).on("upgrade", (req, socket, head) => upgrade(req, socket, head, false));
const sandbox = createServer((req, res) => handle(req, res, true)).on("upgrade", (req, socket, head) => upgrade(req, socket, head, true));

rmSync(dirname(ADMIN_SOCKET), { recursive: true, force: true });
mkdirSync(dirname(ADMIN_SOCKET), { recursive: true, mode: 0o700 });
createSocketServer((socket) => socket.on("error", () => socket.destroy()).end(`${newCode().code}
`)).listen(ADMIN_SOCKET);

try {
  await migrate();
  await secure(await profiles());
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

server.listen(PORT, "0.0.0.0", () => console.log(`weilo-core listening on :${PORT}`));
mkdirSync(SANDBOX_DIR, { recursive: true, mode: 0o700 });
rmSync(SANDBOX_API, { force: true });
sandbox.listen(SANDBOX_API);

void syncCompaction();
void clearScratch();
startActions();
startCurator();

watchdog(HUNG_MS);
void syncIndex().catch((err) => console.error("The chat index cannot be built:", err.message));
void warmModels();
void backfillUsage().catch((err) => console.error("Past usage cannot be counted:", err.message));

const shutDown = () => {
  server.close();
  sandbox.close();
  setTimeout(() => process.exit(0), SHUTDOWN_MS).unref();
  void stopAll()
    .then(() => Promise.all([settled(), audited(), usageSaved()]))
    .finally(() => process.exit(0));
};
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, shutDown);
