import { createServer } from "node:http";
import { createAgent, getAgent, listAgents, removeChat, removeProfile, setOrder, updateAgent } from "./agents/agents.mjs";
import { searchChats } from "./agents/search.mjs";
import { earlierOf } from "./agents/sessions.mjs";
import { abort, activityOf, answer, compact, contextOf, prompt, restart, restartAll, skillCommands, stop, stopAll } from "./agents/runner.mjs";
import { closeBrowser, giveBack, hasWindow, isTaken, showBrowser, takeOver, useBrowser } from "./browser/browser.mjs";
import { getRule, saveRule } from "./browser/rule.mjs";
import { startScreen, viewUpgrade } from "./browser/screen.mjs";
import { fail } from "./common.mjs";
import { PORT } from "./config.mjs";
import { events } from "./http/events.mjs";
import { serveFile } from "./http/files.mjs";
import { bodyOf, guard, reply } from "./http/request.mjs";
import { serveUi } from "./http/static.mjs";
import { fetchKnowledge } from "./memory/fetch.mjs";
import { memoryText, saveMemoryText, useMemory } from "./memory/memory.mjs";
import { getCurator, setCurator, startCurator } from "./memory/curator.mjs";
import { addRoutine, forgetRoutines, listRoutines, noteZone, removeRoutine, startRoutines, updateRoutine } from "./routines/routines.mjs";
import { addExtension, listExtensions, removeExtension } from "./settings/extensions.mjs";
import { addPlugin,listPlugins, pluginStatus, removePlugin } from "./settings/plugins.mjs";
import { answerSignIn, signInStatus, startSignIn, stopSignIn } from "./settings/login.mjs";
import { listModels, listProviders, removeKey, saveKey, setEnabledModels, syncCompaction } from "./settings/providers.mjs";
import { addSkills, listSkills, removeSkill, saveSkill } from "./settings/skills.mjs";
import { getUser, saveUser } from "./settings/user.mjs";
import { sendContact } from "./contact.mjs";
import { migrate } from "./migrate.mjs";
import { addDevice, markSeen, pushStatus, removeDevice, setMuted } from "./push.mjs";
import { setUpdateCheck, updateStatus } from "./update.mjs";
import { BUILD } from "./version.mjs";
import { clearScratch } from "./agents/workspace.mjs";

// JSON API. A handler gets (id, body, request, second id) and returns the reply; no reply means 204.
const routes = [];
const route = (method, path, handler) =>
  routes.push({ method, handler, scoped: path.startsWith("/api/agents/:id"), pattern: new RegExp(`^${path.replace(":id", "([^/]+)").replace(":rid", "([^/]+)")}$`) });

route("GET", "/api/version", () => BUILD);
route("GET", "/api/update", () => updateStatus());
route("PUT", "/api/update", (_, body) => setUpdateCheck(body));
route("POST", "/api/contact", (_, body) => sendContact(body));
route("GET", "/api/providers", () => listProviders());
route("PUT", "/api/providers/:id", (id, { key }) => saveKey(id, key));
route("DELETE", "/api/providers/:id", (id) => removeKey(id));
route("POST", "/api/providers/:id/sign-in", (id) => startSignIn(id));
route("GET", "/api/providers/:id/sign-in", (id) => signInStatus(id));
route("PUT", "/api/providers/:id/sign-in", (id, { answer }) => answerSignIn(id, answer));
route("DELETE", "/api/providers/:id/sign-in", (id) => stopSignIn(id));
route("GET", "/api/models", () => listModels());
route("PUT", "/api/models", (_, { enabled }) => setEnabledModels(enabled));
route("GET", "/api/plugins", () => listPlugins());
route("GET", "/api/plugins/status", () => pluginStatus());
route("POST", "/api/plugins", (_, body) => addPlugin(body));
route("DELETE", "/api/plugins/:id", async (id) => {
  await removePlugin(id);
  await restartAll();
});
route("GET", "/api/skills", () => listSkills());
route("POST", "/api/skills", async (_, body) => {
  await addSkills(body);
  await restartAll();
});
route("DELETE", "/api/skills/:id", async (id) => {
  await removeSkill(id);
  await restartAll();
});
route("GET", "/api/extensions", () => listExtensions());
route("POST", "/api/extensions", async (_, body) => {
  await addExtension(body);
  await restartAll();
});
route("DELETE", "/api/extensions/:id", async (id) => {
  await removeExtension(id);
  await restartAll();
});
route("GET", "/api/user",() => getUser());
route("PUT", "/api/user", async (_, body) => {
  const user = await saveUser(body);
  await restartAll();
  return user;
});
route("GET", "/api/memory", async () => {
  const [text, curator] = await Promise.all([memoryText(), getCurator()]);
  return { text, ...curator };
});
route("PUT", "/api/memory", async (_, { text }) => {
  const saved = await saveMemoryText(text);
  await restartAll();
  return { text: saved };
});
route("PUT", "/api/memory/curator", (_, body) => setCurator(body));
route("GET", "/api/push", () => pushStatus());
route("POST", "/api/push/devices", (_, body) => addDevice(body));
route("DELETE", "/api/push/devices/:id", (id) => removeDevice(id));
route("PUT", "/api/push/muted", (_, { muted }) => setMuted(muted));
// The app asks for the agent list every few seconds while it is on screen (`?seen`): no notifications meanwhile.
route("GET", "/api/agents", async (_, __, req) => (new URL(req.url, "http://localhost").searchParams.has("seen") && markSeen(), await listAgents()).map((agent) => ({ ...agent, working: activityOf(agent.id) !== null, doing: activityOf(agent.id), taken: isTaken(agent.id) })));
route("POST", "/api/agents", (_, body) => createAgent(body));
route("GET", "/api/search", (_, __, req) => searchChats(new URL(req.url, "http://localhost").searchParams.get("q")));
route("PUT", "/api/agents", (_, { order }) => setOrder(order));
route("PUT", "/api/agents/:id", async (id, body) => {
  const agent = await updateAgent(id, body);
  await restart(id);
  return agent;
});
// Deleting an agent: its profile and routines go first, so nothing starts its pi again; then pi stops, a running
// browser step ends and its window closes; then its chat goes, unless the user keeps it.
route("DELETE", "/api/agents/:id", async (id, { keepChat }) => {
  await removeProfile(id);
  await forgetRoutines(id);
  await stop(id);
  await closeBrowser(id);
  if (keepChat !== true) await removeChat(id);
});
route("POST", "/api/agents/:id/message", (id, body) => prompt(id, body));
route("POST", "/api/agents/:id/abort", (id) => abort(id));
route("POST", "/api/agents/:id/answer", (id, body) => answer(id, body));
route("GET", "/api/agents/:id/commands", (id) => skillCommands(id));
route("GET", "/api/agents/:id/context", (id) => contextOf(id));
route("GET", "/api/agents/:id/earlier", (id, _, req) => earlierOf(id, Math.max(0, Number(new URL(req.url, "http://localhost").searchParams.get("skip")) || 0)));
route("POST", "/api/agents/:id/reload", (id) => restart(id));
route("POST", "/api/agents/:id/compact", (id, { instructions }) => compact(id, instructions));
route("POST", "/api/agents/:id/browser", async (id, body) => ({ text: await useBrowser(id, body) }));
route("GET", "/api/agents/:id/browser", async (id) => ({ taken: isTaken(id), hasWindow: await hasWindow(id) }));
route("POST", "/api/agents/:id/browser/show", (id) => showBrowser(id));
route("POST", "/api/agents/:id/browser/take-over", (id) => takeOver(id));
route("POST", "/api/agents/:id/browser/give-back", (id) => giveBack(id));
// An agent's `skill` tool: the skill goes into the library and is switched on for that agent, which reads it when its run ends.
route("POST", "/api/agents/:id/skill", async (id, body) => {
  const { id: skill, folder } = await saveSkill(body);
  const agent = await getAgent(id);
  await updateAgent(id, { skills: [...new Set([...agent.skills, skill])] });
  await restart(id);
  return { text: `Saved the skill "${skill}" in ${folder}/ (put any scripts or other files it needs there). It is on for you and loads when this reply ends. It shows under Skills in Settings.` };
});
route("POST", "/api/agents/:id/memory", async (_, body) => ({ text: await useMemory(body) }));
route("POST", "/api/agents/:id/fetch_knowledge", async (_, body) => ({ text: await fetchKnowledge(body) }));
route("GET", "/api/browser/rule", () => getRule());
route("PUT", "/api/browser/rule", async (_, body) => {
  const rule = await saveRule(body);
  await restartAll();
  return rule;
});
route("GET", "/api/agents/:id/routines", async (id, _, req) => (await noteZone(req.headers["x-timezone"]), listRoutines(id)));
route("POST", "/api/agents/:id/routines", (id, body, req) => addRoutine(id, body, req.headers["x-timezone"]));
route("PUT", "/api/agents/:id/routines/:rid", (id, body, _, rid) => updateRoutine(id, rid, body));
route("DELETE", "/api/agents/:id/routines/:rid", (id, _, __, rid) => removeRoutine(id, rid));

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    guard(req, path);
    if (!path.startsWith("/api/")) return await serveUi(req, res);
    const file = path.match(/^\/api\/files\/(.+)$/);
    if (file && req.method === "GET") return await serveFile(res, file[1], new URL(req.url, "http://localhost").searchParams.has("view"));
    const stream = path.match(/^\/api\/agents\/([^/]+)\/events$/);
    if (stream && req.method === "GET") return await events(req, res, stream[1]);
    for (const { method, pattern, handler, scoped } of routes) {
      const match = req.method === method && path.match(pattern);
      if (!match) continue;
      // A route for an agent only accepts one that exists.
      if (scoped) await getAgent(match[1]);
      const result = await handler(match[1], await bodyOf(req), req, match[2]);
      return result === undefined ? reply(res, 204) : reply(res, 200, result);
    }
    throw fail(404, "Not found");
  } catch (err) {
    if (!err.status) console.error(err);
    if (res.headersSent) return res.destroy();
    reply(res, err.status ?? 500, { error: err.status ? err.message : "An error occurred" });
  }
});

// The screen's live view is a WebSocket, with the same checks as the API.
server.on("upgrade", (req, socket, head) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    guard(req, path);
    if (path === "/api/browser/view" && viewUpgrade(req, socket, head)) return;
  } catch {}
  socket.destroy();
});

// The data folder is brought to this app's shape before anything reads it; one made by a newer app stops the start.
try {
  await migrate();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

server.listen(PORT, "0.0.0.0", () => console.log(`weilo-core listening on :${PORT}`));

void syncCompaction();
// Scratch files from before a restart are no one's now.
void clearScratch();
startRoutines();
startScreen();
startCurator();

for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => stopAll().finally(() => process.exit(0)));
