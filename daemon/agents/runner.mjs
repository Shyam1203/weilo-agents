import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSIONS, fail } from "../common.mjs";
import { agentKey, dropAgentKey } from "../http/access.mjs";
import { BIN, CORE_TOOLS, IDLE_MS, MAX_APPROVAL, PI_BUILTINS, PI_TOOLS, PORT } from "../config.mjs";
import { audit } from "../audit.mjs";
import { askBefore } from "../browser/rule.mjs";
import { addUsage, usageToday } from "./usage.mjs";
import { memoryFlags } from "../memory/memory.mjs";
import { pointOf } from "../settings/compaction.mjs";
import { extensionsOf } from "../settings/extensions.mjs";
import { pluginTools } from "../settings/plugins.mjs";
import { skillPaths } from "../settings/skills.mjs";
import { userFlags } from "../settings/user.mjs";
import { notify } from "../push.mjs";
import { spawnSandboxed } from "../sandbox/client.mjs";
import { ownTools, sharedTools, spawnAs } from "../users.mjs";
import { chatDirOf, getAgent, homeOf, isIsolated, makeHome, mayCall, placesOf, profilePath, userHomeOf, userOf } from "./agents.mjs";
import { piDirOf, piFiles, writePiDir } from "./pidir.mjs";
import { piRpc } from "./pi.mjs";
import { asTyped, chatFiles, textOf } from "./sessions.mjs";
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
    return { profile: profilePath(agent.id), skills, extensions, ours: [WEILO, MEMORY], about, env: sharedTools, scratch: scratchOf(agent.id) };
  }
  const binds = [...placesOf(agent).map((path) => ({ path })), ...[...skills, ...extensions.filter((x) => !x.builtin).map((x) => join(EXTENSIONS, x.id))].map((path) => ({ path, ro: true }))];
  return { profile: join(dir, "agent.json"), skills, extensions, ours: [WEILO], about: ["--no-context-files"], env: ownTools(userHomeOf(agent)), scratch: "/tmp", binds };
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
const replyText = (reply) => textOf(reply.content, " ").trim();

function tell(run) {
  const { reply } = run;
  run.reply = null;
  if (!reply || reply.stopReason === "aborted") return;
  if (reply.stopReason === "error") return void notifyAbout(run.id, "error", reply.errorMessage);
  const text = replyText(reply);
  const shown = Array.isArray(reply.content) && reply.content.some((b) => b.type === "toolCall" && b.name === "show");
  void notifyAbout(run.id, "reply", text || (shown ? "Showed you something." : ""));
}

const overLimit = (agent) => `${agent.name} used its ${agent.dailyTokens} tokens for today. Raise its daily limit in its settings, or wait until tomorrow.`;

async function charge(run, usage) {
  const used = await addUsage(run.id, usage);
  const agent = await getAgent(run.id);
  if (agent.dailyTokens && used >= agent.dailyTokens && run.busy) {
    await run.pi.send("abort").catch(() => {});
    void notifyAbout(run.id, "error", overLimit(agent));
  }
}

async function start(run) {
  await holds.get(run.id);
  const agent = await getAgent(run.id);
  const dir = piDirOf(run.id);
  const [ask, plugins, kind] = await Promise.all([askBefore(), pluginTools(agent.plugins), kindOf(agent, dir)]);
  const argv = argvOf(agent, kind, plugins);
  const user = userOf(agent);
  const isolated = isIsolated(agent);
  await Promise.all([makeHome(agent), isolated ? null : makeScratch(agent)]);
  run.key = agentKey(run.id);
  const files = await piFiles({ model: agent.model, plugins: agent.plugins, key: run.key, agent: run.id });
  const cwd = homeOf(agent);
  const env = {
    ...kind.env, PI_CODING_AGENT_DIR: dir, HOME: userHomeOf(agent),
    WEILO_AGENT: run.id, WEILO_API: `http://127.0.0.1:${PORT}/api`, WEILO_KEY: run.key, WEILO_ASK_BEFORE: ask, WEILO_SCRATCH: kind.scratch,
    ...(isolated && { WEILO_ISOLATED: "1" }),
  };
  let child;
  if (isolated) {
    files["agent.json"] = await readFile(profilePath(agent.id), "utf8");
    child = spawnSandboxed({ user, argv, cwd, env, umask: 0o002, binds: kind.binds, files: Object.fromEntries(Object.entries(files).map(([name, text]) => [join(dir, name), text])) });
  } else {
    await writePiDir(dir, user, files);
    child = spawnAs(user, argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env } });
  }
  run.done = new Promise((resolve) => {
    run.pi = piRpc(child, {
      onEvent(event) {
        if (event.type === "agent_start") (run.busy = true), (run.reply = null);
        if (event.type === "message_end" && event.message?.role === "assistant") (run.reply = event.message), void charge(run, event.message.usage).catch((err) => console.error("Usage:", err.message));
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
        resolve(undefined);
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
  const older = (await chatFiles(id)).length > 1;
  await run.pi.send("get_messages", {}, ({ messages }) => {
    send({ type: "history", messages: messages.map(asTyped), more: older || messages[0]?.role === "compactionSummary", busy: run.busy, asking: run.asking });
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
  const agent = await getAgent(id);
  if (agent.dailyTokens && ((await usageToday())[id] ?? 0) >= agent.dailyTokens) throw fail(429, overLimit(agent));
  const { pi } = await open(id);
  const paths = await saveFiles(agent, files);
  const message = [text.trim(), ...paths.map((path) => `[Attached file: ${path}]`)].filter(Boolean).join("\n\n");
  if (!message && !blocks.length) throw fail(400, "The message is empty");
  return pi.send("prompt", { message, images: blocks, streamingBehavior: "steer" }).catch(refused);
}

export async function promptAndWait(id, text) {
  const run = await open(id);
  let last = null;
  let listen;
  const stop = () => (run.listeners.delete(listen), touch(run));
  const ended = new Promise((resolve) => {
    listen = (event) => {
      if (event.type === "message_end" && event.message?.role === "assistant") last = event.message;
      if (event.type !== "agent_settled" && event.type !== "exit") return;
      stop();
      resolve(last && last.stopReason !== "error" && last.stopReason !== "aborted" ? replyText(last) : null);
    };
    run.listeners.add(listen);
  });
  await prompt(id, { text }).catch((err) => {
    stop();
    throw err;
  });
  return ended;
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
  const answer = await new Promise((resolve) => {
    run.asking = { type: "extension_ui_request", id: `weilo-${randomBytes(6).toString("hex")}`, method: "select", title, options, resolve };
    emit(run, run.asking);
    void notifyAbout(id, "ask", title);
  });
  audit("approval", { agent: id, question: title.slice(0, 500), answer: answer ?? "(none)" });
  return answer;
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

export const stopAll = () => Promise.all([...runs.keys()].map(stop));
