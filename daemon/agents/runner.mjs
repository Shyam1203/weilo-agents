import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSIONS, fail } from "../common.mjs";
import { agentKey, dropAgentKey } from "../http/access.mjs";
import { ASK_CLOSE_MS, ASK_REMIND_MS, BIN, CORE_TOOLS, GLANCE_MS, IDLE_MS, MAX_APPROVAL, NOTHING_NEW, PI_BUILTINS, PI_TOOLS, PORT } from "../config.mjs";
import { audit } from "../audit.mjs";
import { addUsage, usageToday } from "./usage.mjs";
import { getCurator } from "../memory/curator.mjs";
import { memoryFlags } from "../memory/memory.mjs";
import { pointOf } from "../settings/compaction.mjs";
import { extensionsOf } from "../settings/extensions.mjs";
import { pluginTools } from "../settings/plugins.mjs";
import { skillPaths } from "../settings/skills.mjs";
import { userFlags } from "../settings/user.mjs";
import { notify } from "../push.mjs";
import { spawnSandboxed } from "../sandbox/client.mjs";
import { ownTools, passedOn, sharedTools, spawnAs } from "../users.mjs";
import { chatDirOf, getAgent, homeOf, isIsolated, makeHome, mayCall, placesOf, profilePath, userHomeOf, userOf } from "./agents.mjs";
import { piDirOf, piFiles, writePiDir } from "./pidir.mjs";
import { piRpc } from "./pi.mjs";
import { linkImages } from "./images.mjs";
import { asTyped, briefCall, chatFiles, shown, slim, textOf } from "./sessions.mjs";
import { agentsChanged, tellAgent } from "./status.mjs";
import { toImages, uploadedFiles } from "./uploads.mjs";
import { clearScratch, makeScratch, rulesOf, scratchOf } from "./workspace.mjs";

const runs = new Map();
// Who follows each agent's chat. They stay across runs, so an agent that went idle and stopped
// carries on with the same listeners when it starts again.
const watchers = new Map();
const listenersOf = (id) => watchers.get(id) ?? new Set();

// Only what the app draws goes to it. pi's other events repeat what the app already has or
// never shows: agent_end holds the whole run, turn_end its tool results (and most tool results are
// not drawn: a file that was read, a command's output), and the text and thinking
// of a reply arrive in full with message_end. Of a reply as it is written, only a show card is
// drawn, so only tool calls go out, and of their deltas only a show card's.
const RELAYED = new Set(["queue_update", "extension_ui_request", "agent_start", "agent_settled", "message_start", "message_update", "message_end", "compaction_start", "compaction_end", "tool_execution_start", "tool_execution_end"]);
const slimEvent = (run, event) => {
  if (!RELAYED.has(event.type)) return null;
  if (event.type === "tool_execution_start" || event.type === "tool_execution_end") return { type: event.type, toolCallId: event.toolCallId, toolName: event.toolName };
  if (event.type === "compaction_end") return { type: event.type, result: Boolean(event.result) };
  if (event.type === "message_update") {
    const step = event.assistantMessageEvent ?? {};
    if (step.type === "toolcall_start" && step.toolName === "show") run.showing.add(step.contentIndex);
    if (!/^toolcall_/.test(step.type ?? "") || (step.type === "toolcall_delta" && !run.showing.has(step.contentIndex))) return null;
    return { type: event.type, assistantMessageEvent: step.toolCall ? { ...step, toolCall: briefCall(step.toolCall) } : step };
  }
  if (event.type === "message_start") run.showing.clear();
  if (!event.message) return event;
  const message = asTyped(event.message);
  return shown(message) ? { ...event, message: linkImages(slim(message)) } : null;
};

const emit = (run, event) => listenersOf(run.id).forEach((send) => send(event));
/** Tell the app's open chats of an agent about something outside its pi (an action's answer, say). */
export const tellChats = (id, event) => listenersOf(id).forEach((send) => send(event));

// A question nobody answers: a reminder after an hour, and after a day it closes, as if skipped.
const waitFor = (run) => {
  const { id, title } = run.asking;
  run.waiting = [
    setTimeout(() => void notifyAbout(run.id, "remind", title), ASK_REMIND_MS).unref(),
    setTimeout(() => run.asking?.id === id && void answer(run.id, { request: id, value: undefined }).catch(() => {}), ASK_CLOSE_MS).unref(),
  ];
};

const endAsk = (run) => {
  run.waiting?.forEach(clearTimeout);
  run.waiting = null;
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
  if (run.busy || runs.get(run.id) !== run) return;
  const watched = listenersOf(run.id).size > 0;
  run.timer = setTimeout(() => ((run.asleep = true), close(run), void clearScratch(run.id)), run.used || watched ? IDLE_MS : GLANCE_MS).unref();
};

const [WEILO, MEMORY] = ["../weilo.mjs", "../memory/extension.mjs"].map((path) => fileURLToPath(new URL(path, import.meta.url)));

const toolsFlags = (agent, plugins, kind) => {
  const tools = [...PI_TOOLS, ...CORE_TOOLS.filter((t) => mayCall(agent, t) && (t !== "memory" || kind.notes)), ...kind.extensions.flatMap((e) => e.tools)];
  return plugins.length ? ["--tools", [...tools, "codemode", ...plugins].join(",")] : ["--no-mcp", "--tools", tools.join(",")];
};

async function kindOf(agent, dir) {
  const [skills, extensions] = await Promise.all([skillPaths(agent.skills), extensionsOf(agent)]);
  if (!isIsolated(agent)) {
    const { notes } = await getCurator();
    const about = (await Promise.all([userFlags(), notes ? memoryFlags() : []])).flat();
    return { profile: profilePath(agent.id), skills, extensions, ours: [WEILO, MEMORY], about, notes, env: sharedTools, scratch: scratchOf(agent.id) };
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
    ...toolsFlags(agent, plugins, kind),
    "--session-dir", chatDirOf(agent),
    "--session-id", id,
  ];
};

export const isNothingNew = (text) => {
  const words = text.split(/[\s.]+/).filter(Boolean);
  return words.length > 0 && words.every((word) => word === NOTHING_NEW);
};
const notifyAbout = (id, kind, text) => getAgent(id).then((agent) => notify(agent, kind, text)).catch(() => {});
const replyText = (reply) => textOf(reply.content, " ").trim();

function tell(run) {
  const { reply } = run;
  run.reply = null;
  if (!reply || reply.stopReason === "aborted") return;
  if (reply.stopReason === "error") return void notifyAbout(run.id, "error", reply.errorMessage);
  const text = replyText(reply);
  // A check that ran by itself and found nothing new says so with NOTHING_NEW alone: no notification.
  if (isNothingNew(text)) return;
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
  const [plugins, kind] = await Promise.all([pluginTools(agent.plugins), kindOf(agent, dir)]);
  const argv = argvOf(agent, kind, plugins);
  const user = userOf(agent);
  const isolated = isIsolated(agent);
  await Promise.all([makeHome(agent), isolated ? null : makeScratch(agent)]);
  run.key = agentKey(run.id);
  const files = await piFiles({ model: agent.model, plugins: agent.plugins, key: run.key, agent: run.id });
  const cwd = homeOf(agent);
  const env = {
    ...kind.env, PI_CODING_AGENT_DIR: dir, HOME: userHomeOf(agent),
    WEILO_AGENT: run.id, WEILO_API: `http://127.0.0.1:${PORT}/api`, WEILO_KEY: run.key, WEILO_SCRATCH: kind.scratch,
    ...(isolated && { WEILO_ISOLATED: "1" }),
  };
  let child;
  if (isolated) {
    files["agent.json"] = await readFile(profilePath(agent.id), "utf8");
    child = spawnSandboxed({ user, argv, cwd, env, umask: 0o002, binds: kind.binds, files: Object.fromEntries(Object.entries(files).map(([name, text]) => [join(dir, name), text])) });
  } else {
    await writePiDir(dir, user, files);
    child = spawnAs(user, argv[0], argv.slice(1), { cwd, env: { ...passedOn(), ...env } });
  }
  run.done = new Promise((resolve) => {
    run.pi = piRpc(child, {
      onEvent(event) {
        if (event.type === "agent_start") (run.busy = true), (run.used = true), (run.reply = null);
        if (event.type === "queue_update") for (const text of run.held.keys()) if (!event.steering?.includes(text) && !event.followUp?.includes(text)) run.held.delete(text);
        if (event.type === "message_end" && event.message?.role === "assistant") (run.reply = event.message), void charge(run, event.message.usage).catch((err) => console.error("Usage:", err.message));
        if (event.type === "agent_settled") (run.busy = false), tell(run);
        if (event.type === "tool_execution_start") run.doing = event.toolName;
        if (event.type === "tool_execution_end" || !run.busy) run.doing = "";
        if (event.type === "extension_ui_request") {
          if (event.method === "select" || event.method === "input") endAsk(run), (run.asking = event), waitFor(run), void notifyAbout(run.id, "ask", event.title);
          else if (event.method === "confirm" || event.method === "editor") run.pi.reply({ type: "extension_ui_response", id: event.id, cancelled: true });
        }
        if ((event.type === "tool_execution_end" && !run.asking?.resolve) || !run.busy) endAsk(run);
        if (ACTIVITY.has(event.type)) tellAgent(run.id, { working: run.busy, doing: run.busy ? (run.doing ?? "") : null });
        if (event.type === "message_end" && (event.message?.role === "assistant" || event.message?.role === "user")) agentsChanged();
        const relayed = slimEvent(run, event);
        if (relayed) emit(run, relayed);
        if (run.stale && !run.busy) close(run);
        else touch(run);
      },
      onExit({ code, message }) {
        close(run);
        endAsk(run);
        tellAgent(run.id, { working: false, doing: null });
        // An agent that was idle stops quietly: the app keeps its chat and it starts again when needed.
        if (!run.asleep || code) emit(run, { type: "exit", code, error: code ? message : "" });
        resolve(undefined);
      },
    });
  });
  return run;
}

const ACTIVITY = new Set(["agent_start", "agent_settled", "tool_execution_start", "tool_execution_end"]);

const holds = new Map();

const open = (id) => {
  if (!runs.has(id)) {
    const run = { id, busy: false, stale: false, asleep: false, timer: null, showing: new Set(), held: new Map() };
    run.ready = start(run).catch((err) => {
      close(run);
      throw err;
    });
    runs.set(id, run);
  }
  return runs.get(id).ready;
};

const current = (id) => runs.get(id)?.ready.catch(() => null);

const listen = (id, send) => {
  if (!watchers.has(id)) watchers.set(id, new Set());
  watchers.get(id).add(send);
  return () => {
    const set = watchers.get(id);
    set?.delete(send);
    if (set?.size === 0) watchers.delete(id);
    void current(id)?.then((run) => run && touch(run));
  };
};

export async function subscribe(id, send) {
  const run = await open(id);
  const older = (await chatFiles(id)).length > 1;
  let off;
  await run.pi.send("get_messages", {}, ({ messages }) => {
    send({ type: "history", messages: messages.map(asTyped).filter(shown).map(slim).map((m) => linkImages(m)), more: older || messages[0]?.role === "compactionSummary", busy: run.busy, asking: run.asking });
    off = listen(id, send);
  });
  touch(run);
  return off;
}

const refused = (err) => {
  throw fail(409, err.message);
};

const BEHAVIOR = { now: "steer", later: "followUp" };
const behaviorOf = (when) => (Object.hasOwn(BEHAVIOR, when) ? BEHAVIOR[when] : null);

export async function prompt(id, { text = "", images = [], files = [], when = "now" }) {
  const behavior = behaviorOf(when);
  if (typeof text !== "string" || !behavior) throw fail(400, "The message is not valid");
  const blocks = toImages(images);
  const agent = await getAgent(id);
  if (agent.dailyTokens && ((await usageToday())[id] ?? 0) >= agent.dailyTokens) throw fail(429, overLimit(agent));
  const paths = await uploadedFiles(agent, files);
  const run = await open(id);
  const message = [text.trim(), ...paths.map((path) => `[Attached file: ${path}]`)].filter(Boolean).join("\n\n");
  if (!message && !blocks.length) throw fail(400, "The message is empty");
  if (run.busy && blocks.length) run.held.set(message, blocks);
  return run.pi.send("prompt", { message, images: blocks, streamingBehavior: behavior }).catch(refused);
}

// pi clears its queue only as a whole: take it, drop the one message, and queue the rest again in order.
// One at a time per agent, so two quick takebacks do not lose each other's messages.
export async function unqueue(id, { text, when = "now" }) {
  if (typeof text !== "string" || !behaviorOf(when)) throw fail(400, "The message is not valid");
  const run = await current(id);
  if (!run) return;
  const done = (run.unqueuing ?? Promise.resolve()).then(() => requeueWithout(run, text, when));
  run.unqueuing = done.catch(() => {});
  return done;
}

async function requeueWithout(run, text, when) {
  const held = new Map(run.held);
  const { steering, followUp } = await run.pi.send("clear_queue").catch(refused);
  const list = when === "later" ? followUp : steering;
  if (list.includes(text)) list.splice(list.indexOf(text), 1);
  for (const [behavior, messages] of [["steer", steering], ["followUp", followUp]])
    for (const message of messages) {
      const images = held.get(message) ?? [];
      if (images.length) run.held.set(message, images);
      await run.pi.send("prompt", { message, images, streamingBehavior: behavior }).catch(refused);
    }
}

export async function promptAndWait(id, text) {
  await open(id);
  let last = null;
  let off;
  const stop = () => off();
  const ended = new Promise((resolve) => {
    off = listen(id, (event) => {
      if (event.type === "message_end" && event.message?.role === "assistant") last = event.message;
      if (event.type !== "agent_settled" && event.type !== "exit") return;
      stop();
      resolve(last && last.stopReason !== "error" && last.stopReason !== "aborted" ? replyText(last) : null);
    });
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

/** Ask the user in the chat and wait. secret: a field for a key, whose value goes to the app alone (never to the agent, the audit or a notification). */
export async function askUser(id, title, options, { secret = false } = {}) {
  if (title.length > MAX_APPROVAL) throw fail(400, `This request is too long to show the user in full (${title.length} characters; at most ${MAX_APPROVAL}). Make it shorter.`);
  const run = await current(id);
  if (!run?.busy) throw fail(409, "The agent is not in a run");
  endAsk(run);
  const answer = await new Promise((resolve) => {
    run.asking = { type: "extension_ui_request", id: `weilo-${randomBytes(6).toString("hex")}`, method: secret ? "secret" : "select", title, options: secret ? [] : options, resolve };
    emit(run, run.asking);
    waitFor(run);
    void notifyAbout(id, "ask", title);
  });
  audit("approval", { agent: id, question: title.slice(0, 500), answer: secret ? (answer ? "(saved)" : "(none)") : (answer ?? "(none)") });
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
