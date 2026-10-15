import { randomBytes } from "node:crypto";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSIONS, fail } from "../common.mjs";
import { agentKey, dropAgentKey } from "../http/access.mjs";
import { BIN, CORE_TOOLS, IDLE_MS, MAX_APPROVAL, PI_BUILTINS, PI_TOOLS, PORT } from "../config.mjs";
import { askBefore } from "../browser/rule.mjs";
import { memoryFlags } from "../memory/memory.mjs";
import { pointOf } from "../settings/compaction.mjs";
import { extensionsOf } from "../settings/extensions.mjs";
import { pluginTools } from "../settings/plugins.mjs";
import { skillPaths } from "../settings/skills.mjs";
import { userFlags } from "../settings/user.mjs";
import { notify } from "../push.mjs";
import { ownTools, sharedTools } from "../users.mjs";
import { chatDirOf, getAgent, homeOf, isIsolated, makeHome, mayCall, profilePath, profiles, userHomeOf, userOf } from "./agents.mjs";
import { piDirOf, writePiDir } from "./pidir.mjs";
import { spawnPi } from "./pi.mjs";
import { asTyped } from "./sessions.mjs";
import { saveFiles, toImages } from "./uploads.mjs";
import { clearScratch, makeScratch, rulesOf, scratchOf } from "./workspace.mjs";

const runs = new Map();

const emit = (run, event) => run.listeners.forEach((send) => send(event));

const endAsk = (run) => {
  if (!run.asking) return;
  const { id, resolve } = run.asking;
  run.asking = null;
  resolve?.(undefined);
  emit(run, { type: "ask_end", id });
};

const close = (run) => {
  if (runs.get(run.id) === run) runs.delete(run.id);
  clearTimeout(run.timer);
  run.pi?.close();
  if (run.key) dropAgentKey(run.key);
};

const touch = (run) => {
  clearTimeout(run.timer);
  if (run.busy || run.listeners.size || runs.get(run.id) !== run) return;
  run.timer = setTimeout(() => (close(run), void clearScratch(run.id)), IDLE_MS).unref();
};

const [WEILO, MEMORY] = ["../weilo.mjs", "../memory/extension.mjs"].map((path) => fileURLToPath(new URL(path, import.meta.url)));

const toolsFlags = (agent, plugins, extensions) => {
  const tools = [...PI_TOOLS, ...CORE_TOOLS.filter((t) => mayCall(agent, t)), ...extensions.flatMap((e) => e.tools)];
  return plugins.length ? ["--tools", [...tools, "codemode", ...plugins].join(",")] : ["--no-mcp", "--tools", tools.join(",")];
};

async function kindOf(agent, dir) {
  const [skills, extensions] = await Promise.all([skillPaths(agent.skills), extensionsOf(agent)]);
  if (!isIsolated(agent)) {
    const about = (await Promise.all([userFlags(), memoryFlags()])).flat();
    return { profile: profilePath(agent.id), skills, extensions, ours: [WEILO, MEMORY], about, copies: {}, env: sharedTools };
  }
  const copies = { "agent.json": profilePath(agent.id) };
  for (const path of skills) copies[`skills/${basename(path)}`] = path;
  const own = extensions.map((x) => {
    if (x.builtin) return x;
    copies[`extensions/${x.id}`] = join(EXTENSIONS, x.id);
    return { ...x, entry: join(dir, "extensions", x.id, relative(join(EXTENSIONS, x.id), x.entry)) };
  });
  return { profile: join(dir, "agent.json"), skills: skills.map((path) => join(dir, "skills", basename(path))), extensions: own, ours: [WEILO], about: ["--no-context-files"], copies, env: ownTools(userHomeOf(agent)) };
}

const argvOf = (agent, kind, plugins) => {
  const { id, model, thinking } = agent;
  return [
    BIN.pi, "--mode", "rpc",
    ...(model ? ["--model", model] : []),
    ...(thinking ? ["--thinking", thinking] : []),
    "--append-system-prompt", kind.profile,
    "--append-system-prompt", rulesOf(agent),
    ...kind.about,
    "-ne", ...PI_BUILTINS.flatMap((name) => ["-e", `builtin:${name}`]),
    ...kind.ours.flatMap((path) => ["-e", path]), ...kind.extensions.flatMap((e) => ["-e", e.entry]),
    "--no-skills", ...kind.skills.flatMap((path) => ["--skill", path]),
    ...toolsFlags(agent, plugins, kind.extensions),
    "--session-dir", chatDirOf(agent),
    "--session-id", id,
  ];
};

const notifyAbout = (id, kind, text) => getAgent(id).then((agent) => notify(agent, kind, text)).catch(() => {});
function tell(run) {
  const { reply } = run;
  run.reply = null;
  if (!reply || reply.stopReason === "aborted") return;
  if (reply.stopReason === "error") return void notifyAbout(run.id, "error", reply.errorMessage);
  const text = typeof reply.content === "string" ? reply.content : reply.content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
  const shown = Array.isArray(reply.content) && reply.content.some((b) => b.type === "toolCall" && b.name === "show");
  void notifyAbout(run.id, "reply", text.trim() || (shown ? "Showed you something." : ""));
}

async function start(run) {
  await holds.get(run.id);
  const agent = await getAgent(run.id);
  const dir = piDirOf(run.id);
  const [ask, plugins, kind, agents] = await Promise.all([askBefore(), pluginTools(agent.plugins), kindOf(agent, dir), profiles()]);
  const argv = argvOf(agent, kind, plugins);
  const user = userOf(agent, agents);
  await Promise.all([makeScratch(agent), makeHome(agent)]);
  run.key = agentKey(run.id);
  await writePiDir(dir, user, { model: agent.model, plugins: agent.plugins, key: run.key, agent: run.id, copies: kind.copies });
  run.done = new Promise((resolve) => {
    run.pi = spawnPi(argv, {
      user,
      cwd: homeOf(agent),
      env: {
        ...kind.env, PI_CODING_AGENT_DIR: dir, HOME: userHomeOf(agent),
        WEILO_AGENT: run.id, WEILO_API: `http://127.0.0.1:${PORT}/api`, WEILO_KEY: run.key, WEILO_ASK_BEFORE: ask, WEILO_SCRATCH: scratchOf(run.id),
        ...(isIsolated(agent) && { WEILO_ISOLATED: "1" }),
      },
      onEvent(event) {
        if (event.type === "agent_start") (run.busy = true), (run.reply = null);
        if (event.type === "message_end" && event.message?.role === "assistant") run.reply = event.message;
        if (event.type === "agent_settled") (run.busy = false), tell(run);
        if (event.type === "tool_execution_start") run.doing = event.toolName;
        if (event.type === "tool_execution_end" || !run.busy) run.doing = "";
        if (event.type === "extension_ui_request") {
          if (event.method === "select" || event.method === "input") endAsk(run), (run.asking = event), void notifyAbout(run.id, "ask", event.title);
          else if (event.method === "confirm" || event.method === "editor") run.pi.reply({ type: "extension_ui_response", id: event.id, cancelled: true });
        }
        if ((event.type === "tool_execution_end" && !run.asking?.resolve) || !run.busy) endAsk(run);
        emit(run, event.message ? { ...event, message: asTyped(event.message) } : event);
        if (run.stale && !run.busy) close(run);
        else touch(run);
      },
      onExit({ code, message }) {
        close(run);
        endAsk(run);
        emit(run, { type: "exit", code, error: code ? message : "" });
        resolve();
      },
    });
  });
  return run;
}

const holds = new Map();

const open = (id) => {
  if (!runs.has(id)) {
    const run = { id, listeners: new Set(), busy: false, stale: false, timer: null };
    run.ready = start(run).catch((err) => {
      close(run);
      throw err;
    });
    runs.set(id, run);
  }
  return runs.get(id).ready;
};

const current = (id) => runs.get(id)?.ready.catch(() => null);

export async function subscribe(id, send) {
  const run = await open(id);
  await run.pi.send("get_messages", {}, ({ messages }) => {
    send({ type: "history", messages: messages.map(asTyped), busy: run.busy, asking: run.asking });
    run.listeners.add(send);
  });
  touch(run);
  return () => {
    run.listeners.delete(send);
    touch(run);
  };
}

const refused = (err) => {
  throw fail(409, err.message);
};

export async function prompt(id, { text = "", images = [], files = [] }) {
  if (typeof text !== "string") throw fail(400, "The message is not valid");
  const blocks = toImages(images);
  const { pi } = await open(id);
  const paths = await saveFiles(await getAgent(id), files);
  const message = [text.trim(), ...paths.map((path) => `[Attached file: ${path}]`)].filter(Boolean).join("\n\n");
  if (!message && !blocks.length) throw fail(400, "The message is empty");
  return pi.send("prompt", { message, images: blocks, streamingBehavior: "steer" }).catch(refused);
}

export async function skillCommands(id) {
  const { commands } = await (await open(id)).pi.send("get_commands").catch(refused);
  return commands.filter((c) => c.source === "skill").map((c) => ({ name: c.name.replace(/^skill:/, ""), description: c.description ?? "" }));
}

async function usageOf(run, after) {
  const { contextUsage } = await run.pi.send("get_session_stats").catch(refused);
  if (!contextUsage?.contextWindow) return null;
  const window = contextUsage.contextWindow;
  return { tokens: after === undefined ? contextUsage.tokens : after, window, point: await pointOf((await getAgent(run.id)).model, window) };
}

export const contextOf = async (id) => usageOf(await open(id));

export async function compact(id, instructions) {
  if (instructions !== undefined && typeof instructions !== "string") throw fail(400, "The instructions are not valid");
  const run = await open(id);
  if (run.busy) throw fail(409, "Wait for the agent to finish, or stop it, then compact");
  const { estimatedTokensAfter } = await run.pi.send("compact", instructions?.trim() ? { customInstructions: instructions.trim() } : {}).catch(refused);
  return usageOf(run, estimatedTokensAfter ?? null);
}

export const activityOf = (id) => {
  const run = runs.get(id);
  return run?.busy ? (run.doing ?? "") : null;
};

export async function answer(id, { request, value }) {
  const run = await current(id);
  if (!run?.asking || run.asking.id !== request || (value !== undefined && typeof value !== "string")) throw fail(409, "This question is closed");
  const { resolve } = run.asking;
  if (resolve) {
    run.asking = { ...run.asking, resolve: null };
    resolve(value);
  } else run.pi.reply({ type: "extension_ui_response", id: request, ...(value === undefined ? { cancelled: true } : { value }) });
  endAsk(run);
}

export async function askUser(id, title, options) {
  if (title.length > MAX_APPROVAL) throw fail(400, `This request is too long to show the user in full (${title.length} characters; at most ${MAX_APPROVAL}). Make it shorter.`);
  const run = await current(id);
  if (!run?.busy) throw fail(409, "The agent is not in a run");
  endAsk(run);
  return new Promise((resolve) => {
    run.asking = { type: "extension_ui_request", id: `weilo-${randomBytes(6).toString("hex")}`, method: "select", title, options, resolve };
    emit(run, run.asking);
    void notifyAbout(id, "ask", title);
  });
}

export const abort = async (id) => (await current(id))?.pi.send("abort").catch(refused);

export async function stop(id) {
  const run = await current(id);
  if (!run) return;
  close(run);
  await run.done;
}

export async function restart(id) {
  const run = await current(id);
  if (run?.busy) run.stale = true;
  else await stop(id);
}

export async function holding(id, job) {
  const done = stop(id).then(job);
  holds.set(id, done.catch(() => {}));
  try {
    return await done;
  } finally {
    holds.delete(id);
  }
}

export const restartAll = () => Promise.all([...runs.keys()].map(restart));

export const restartRegular = () =>
  Promise.all([...runs.keys()].map(async (id) => {
    const agent = await getAgent(id).catch(() => null);
    if (agent && !isIsolated(agent)) await restart(id);
  }));

export const stopAll = () => Promise.all([...runs.keys()].map(stop));
