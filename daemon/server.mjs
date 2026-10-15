import { createServer } from "node:http";
import { createAgent, getAgent, homeOf, listAgents, removeChat, removeHome, removeProfile, setOrder, updateAgent } from "./agents/agents.mjs";
import { abort, activityOf, answer, compact, contextOf, prompt, restart, restartAll, skillCommands, stop, stopAll } from "./agents/runner.mjs";
import { searchChats } from "./agents/search.mjs";
import { earlierOf } from "./agents/sessions.mjs";
import { clearScratch } from "./agents/workspace.mjs";
import { closeBrowser, giveBack, hasWindow, isTaken, showBrowser, takeOver, useBrowser } from "./browser/browser.mjs";
import { getRule, saveRule } from "./browser/rule.mjs";
import { startScreen, viewUpgrade } from "./browser/screen.mjs";
import { fail } from "./common.mjs";
import { PORT } from "./config.mjs";
import { sendContact } from "./contact.mjs";
import { events } from "./http/events.mjs";
import { serveFile } from "./http/files.mjs";
import { bodyOf, guard, reply } from "./http/request.mjs";
import { serveUi } from "./http/static.mjs";
import { getCurator, setCurator, startCurator } from "./memory/curator.mjs";
import { fetchKnowledge } from "./memory/fetch.mjs";
import { memoryText, saveMemoryText, useMemory } from "./memory/memory.mjs";
import { migrate } from "./migrate.mjs";
import { addDevice, markSeen, pushStatus, removeDevice, setMuted } from "./push.mjs";
import { addRoutine, forgetRoutines, listRoutines, noteZone, removeRoutine, startRoutines, updateRoutine } from "./routines/routines.mjs";
import { addExtension, listExtensions, removeExtension } from "./settings/extensions.mjs";
import { answerSignIn, signInStatus, startSignIn, stopSignIn } from "./settings/login.mjs";
import { addPlugin, listPlugins, pluginStatus, removePlugin } from "./settings/plugins.mjs";
import { listModels, listProviders, removeKey, saveKey, setEnabledModels, syncCompaction } from "./settings/providers.mjs";
import { addSkills, listSkills, removeSkill, saveSkill } from "./settings/skills.mjs";
import { getUser, saveUser } from "./settings/user.mjs";
import { setUpdateCheck, updateStatus } from "./update.mjs";
import { BUILD } from "./version.mjs";

// JSON API. A handler gets the request as { id, rid (the path's ids), body, query, headers } and returns the reply; no reply
// means 204.
const routes = [];
const route = (method, path, handler) =>
  routes.push({ method, handler, scoped: path.startsWith("/api/agents/:id"), pattern: new RegExp(`^${path.replace(":id", "([^/]+)").replace(":rid", "([^/]+)")}$`) });

// A change every agent's pi reads when it starts (skills, plugins, extensions, what it knows about you, memory, the browser
// rule): agents start their pi anew once it is saved.
const forAll = (change) => async (req) => {
  const result = await change(req);
  await restartAll();
  return result;
};

route("GET", "/api/version", () => BUILD);
route("GET", "/api/update", () => updateStatus());
route("PUT", "/api/update", ({ body }) => setUpdateCheck(body));
route("POST", "/api/contact", ({ body }) => sendContact(body));
route("GET", "/api/providers", () => listProviders());
route("PUT", "/api/providers/:id", ({ id, body }) => saveKey(id, body.key));
route("DELETE", "/api/providers/:id", ({ id }) => removeKey(id));
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
route("GET", "/api/skills", () => listSkills());
route("POST", "/api/skills", forAll(({ body }) => addSkills(body)));
route("DELETE", "/api/skills/:id", forAll(({ id }) => removeSkill(id)));
route("GET", "/api/extensions", () => listExtensions());
route("POST", "/api/extensions", forAll(({ body }) => addExtension(body)));
route("DELETE", "/api/extensions/:id", forAll(({ id }) => removeExtension(id)));
route("GET", "/api/user", () => getUser());
route("PUT", "/api/user", forAll(({ body }) => saveUser(body)));
route("GET", "/api/memory", async () => {
  const [text, curator] = await Promise.all([memoryText(), getCurator()]);
  return { text, ...curator };
});
route("PUT", "/api/memory", forAll(async ({ body }) => ({ text: await saveMemoryText(body.text) })));
route("PUT", "/api/memory/curator", ({ body }) => setCurator(body));
route("GET", "/api/push", () => pushStatus());
route("POST", "/api/push/devices", ({ body }) => addDevice(body));
route("DELETE", "/api/push/devices/:id", ({ id }) => removeDevice(id));
route("PUT", "/api/push/muted", ({ body }) => setMuted(body.muted));
route("GET", "/api/browser/rule", () => getRule());
route("PUT", "/api/browser/rule", forAll(({ body }) => saveRule(body)));
route("GET", "/api/search", ({ query }) => searchChats(query.get("q")));
// The app asks for the agent list every few seconds while it is on screen (`?seen`): no notifications meanwhile.
route("GET", "/api/agents", async ({ query }) => {
  if (query.has("seen")) markSeen();
  return (await listAgents()).map((agent) => ({ ...agent, working: activityOf(agent.id) !== null, doing: activityOf(agent.id), taken: isTaken(agent.id) }));
});
route("POST", "/api/agents", ({ body }) => createAgent(body));
route("PUT", "/api/agents", ({ body }) => setOrder(body.order));
route("PUT", "/api/agents/:id", async ({ id, body }) => {
  const agent = await updateAgent(id, body);
  await restart(id);
  return agent;
});
// Deleting an agent: its profile and routines go first, so nothing starts its pi again; then pi stops, a running
// browser step ends and its window closes; then its chat and its folder go, each unless the user keeps it.
route("DELETE", "/api/agents/:id", async ({ id, body }) => {
  const agent = await getAgent(id);
  await removeProfile(id);
  await forgetRoutines(id);
  await stop(id);
  await closeBrowser(id);
  if (body.keepChat !== true) await removeChat(id);
  if (body.keepFiles !== true) await removeHome(agent);
});
route("POST", "/api/agents/:id/message", ({ id, body }) => prompt(id, body));
route("POST", "/api/agents/:id/abort", ({ id }) => abort(id));
route("POST", "/api/agents/:id/answer", ({ id, body }) => answer(id, body));
route("GET", "/api/agents/:id/commands", ({ id }) => skillCommands(id));
route("GET", "/api/agents/:id/context", ({ id }) => contextOf(id));
route("GET", "/api/agents/:id/earlier", ({ id, query }) => earlierOf(id, Math.max(0, Number(query.get("skip")) || 0)));
route("POST", "/api/agents/:id/reload", ({ id }) => restart(id));
route("POST", "/api/agents/:id/compact", ({ id, body }) => compact(id, body.instructions));
route("POST", "/api/agents/:id/browser", async ({ id, body }) => ({ text: await useBrowser(id, body) }));
route("GET", "/api/agents/:id/browser", async ({ id }) => ({ taken: isTaken(id), hasWindow: await hasWindow(id) }));
route("POST", "/api/agents/:id/browser/show", ({ id }) => showBrowser(id));
route("POST", "/api/agents/:id/browser/take-over", ({ id }) => takeOver(id));
route("POST", "/api/agents/:id/browser/give-back", ({ id }) => giveBack(id));
// An agent's `skill` tool: the skill goes into the library and is switched on for that agent, which reads it when its run ends.
route("POST", "/api/agents/:id/skill", async ({ id, body }) => {
  const { id: skill, folder } = await saveSkill(body);
  const agent = await getAgent(id);
  await updateAgent(id, { skills: [...new Set([...agent.skills, skill])] });
  await restart(id);
  return { text: `Saved the skill "${skill}" in ${folder}/ (put any scripts or other files it needs there). It is on for you and loads when this reply ends. It shows under Skills in Settings.` };
});
route("POST", "/api/agents/:id/memory", async ({ body }) => ({ text: await useMemory(body) }));
route("POST", "/api/agents/:id/fetch_knowledge", async ({ body }) => ({ text: await fetchKnowledge(body) }));
route("GET", "/api/agents/:id/routines", async ({ id, headers }) => (await noteZone(headers["x-timezone"]), listRoutines(id)));
route("POST", "/api/agents/:id/routines", ({ id, body, headers }) => addRoutine(id, body, headers["x-timezone"]));
route("PUT", "/api/agents/:id/routines/:rid", ({ id, rid, body }) => updateRoutine(id, rid, body));
route("DELETE", "/api/agents/:id/routines/:rid", ({ id, rid }) => removeRoutine(id, rid));

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;
    guard(req, path);
    if (!path.startsWith("/api/")) return await serveUi(req, res);
    const file = path.match(/^\/api\/agents\/([^/]+)\/files\/(.+)$/);
    if (file && req.method === "GET") return await serveFile(res, homeOf(await getAgent(file[1])), file[2], url.searchParams.has("view"));
    const stream = path.match(/^\/api\/agents\/([^/]+)\/events$/);
    if (stream && req.method === "GET") return await events(req, res, stream[1]);
    for (const { method, pattern, handler, scoped } of routes) {
      const match = req.method === method && path.match(pattern);
      if (!match) continue;
      const [, id, rid] = match;
      // A route for an agent only accepts one that exists.
      if (scoped) await getAgent(id);
      const result = await handler({ id, rid, body: await bodyOf(req), query: url.searchParams, headers: req.headers });
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
