import { randomBytes } from "node:crypto";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { EXTENSIONS, fail } from "../common.mjs";
import { agentKey, dropAgentKey } from "../http/access.mjs";
import { BIN, CORE_TOOLS, IDLE_MS, PI_BUILTINS, PI_TOOLS, PORT, SHARED_TOOLS } from "../config.mjs";
import { askBefore } from "../browser/rule.mjs";
import { memoryFlags } from "../memory/memory.mjs";
import { pointOf } from "../settings/compaction.mjs";
import { extensionsOf } from "../settings/extensions.mjs";
import { pluginTools } from "../settings/plugins.mjs";
import { skillPaths } from "../settings/skills.mjs";
import { userFlags } from "../settings/user.mjs";
import { notify } from "../push.mjs";
import { ownTools, sharedTools } from "../users.mjs";
import { chatDirOf, getAgent, homeOf, isIsolated, makeHome, profilePath, userHomeOf, userOf } from "./agents.mjs";
import { piDirOf, writePiDir } from "./pidir.mjs";
import { spawnPi } from "./pi.mjs";
import { asTyped } from "./sessions.mjs";
import { saveFiles, toImages } from "./uploads.mjs";
import { clearScratch, makeScratch, rulesOf, scratchOf } from "./workspace.mjs";

// One pi per agent that is open. It starts on first use and stops after IDLE_MS with nobody
// watching and no run in progress.
// agent id -> run: { id, ready: Promise<run>, pi, listeners, busy, doing, asking, reply, stale, timer, done }
// `reply` is the run's newest message from the agent, for the notification when the run ends.
// `asking` is the question the agent waits on, as pi sent it (`extension_ui_request`), or as the daemon asks it (`askUser`), with
// `resolve` for the answer.
const runs = new Map();

const emit = (run, event) => run.listeners.forEach((send) => send(event));

// The agent's question is over (answered, or the run went on without it). A question of the daemon's that ends unanswered
// gets no answer (undefined).
const endAsk = (run) => {
  if (!run.asking) return;
  const { id, resolve } = run.asking;
  run.asking = null;
  resolve?.(undefined);
  emit(run, { type: "ask_end", id });
};

// A closing run leaves `runs` at once, so the next viewer or message starts a new pi.
const close = (run) => {
  if (runs.get(run.id) === run) runs.delete(run.id);
  clearTimeout(run.timer);
  run.pi?.close();
  if (run.key) dropAgentKey(run.key);
};

const touch = (run) => {
  clearTimeout(run.timer);
  // A run that closed already needs no timer (a viewer can leave after it closed).
  if (run.busy || run.listeners.size || runs.get(run.id) !== run) return;
  // An agent that goes idle is done with its scratch files.
  run.timer = setTimeout(() => (close(run), void clearScratch(run.id)), IDLE_MS).unref();
};

// Our extensions: the chat's tools, for every agent, and memory's, for every agent but an isolated one.
const [WEILO, MEMORY] = ["../weilo.mjs", "../memory/extension.mjs"].map((path) => fileURLToPath(new URL(path, import.meta.url)));

// The tools an agent may call, as pi's allowlist: pi's built-in ones, our tools (an isolated agent's without those of what all
// agents share), its extensions' and its plugins'. With no plugin, MCP is off.
const toolsFlags = (agent, plugins, extensions) => {
  const tools = [...PI_TOOLS, ...CORE_TOOLS.filter((t) => !isIsolated(agent) || !SHARED_TOOLS.includes(t)), ...extensions.flatMap((e) => e.tools)];
  return plugins.length ? ["--tools", [...tools, "codemode", ...plugins].join(",")] : ["--no-mcp", "--tools", tools.join(",")];
};

// What an agent's pi starts with that differs by its kind. A regular agent's pi reads its profile, skills and added
// extensions in agent/, with what it knows about you and remembers, and finds the tools the agents share. An isolated
// agent's cannot open agent/: it reads copies of them in its pi folder (`copies`, for pidir.mjs), knows nothing of the
// shared memory, loads no AGENTS.md or CLAUDE.md (others may write its folder), and finds only root's programs and its own.
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

// pi's command line for an agent: its profile (which holds its instructions), the rules for its folder, what it knows about
// you and remembers, model, thinking level, the extensions it loads (pi's built-in ones, ours, the app's that it has not
// turned off, and the ones it uses), skills and plugins, and its one conversation.
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

// A notification on your devices (push.mjs) when a run ends: its answer, or its error. A run you stopped sends none.
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
  // An agent whose folders are moving starts once they are in place.
  await holds.get(run.id);
  const agent = await getAgent(run.id);
  const dir = piDirOf(run.id);
  const [ask, plugins, kind] = await Promise.all([askBefore(), pluginTools(agent.plugins), kindOf(agent, dir)]);
  const argv = argvOf(agent, kind, plugins);
  await Promise.all([makeScratch(agent), makeHome(agent)]);
  // The key its tools and its pi call the daemon with (tool.mjs, gateway/): the daemon knows the agent by it.
  run.key = agentKey(run.id);
  // Its pi settings: its model's provider and its plugins, through the daemon (no key of theirs), and the copies it reads.
  await writePiDir(dir, userOf(agent), { model: agent.model, plugins: agent.plugins, key: run.key, agent: run.id, copies: kind.copies });
  run.done = new Promise((resolve) => {
    // As the agent's own user, at home in its folder.
    run.pi = spawnPi(argv, {
      user: userOf(agent),
      cwd: homeOf(agent),
      env: {
        ...kind.env, PI_CODING_AGENT_DIR: dir, HOME: userHomeOf(agent),
        WEILO_AGENT: run.id, WEILO_API: `http://127.0.0.1:${PORT}/api`, WEILO_KEY: run.key, WEILO_ASK_BEFORE: ask, WEILO_SCRATCH: scratchOf(run.id),
        // The tools say what an isolated agent may ask for (weilo.mjs).
        ...(isIsolated(agent) && { WEILO_ISOLATED: "1" }),
      },
      onEvent(event) {
        if (event.type === "agent_start") (run.busy = true), (run.reply = null);
        if (event.type === "message_end" && event.message?.role === "assistant") run.reply = event.message;
        if (event.type === "agent_settled") (run.busy = false), tell(run);
        if (event.type === "tool_execution_start") run.doing = event.toolName;
        if (event.type === "tool_execution_end" || !run.busy) run.doing = "";
        if (event.type === "extension_ui_request") {
          // Only the agent's own questions (`ask`: a choice or a line of text) reach the user; pi may ask others.
          if (event.method === "select" || event.method === "input") endAsk(run), (run.asking = event), void notifyAbout(run.id, "ask", event.title);
          else if (event.method === "confirm" || event.method === "editor") run.pi.reply({ type: "extension_ui_response", id: event.id, cancelled: true });
        }
        // A question of the daemon's waits on the agent's tool call, which ends it: another tool ending does not.
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

// Agents whose folders are moving (`holding`): their pi waits to start until the move is done.
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

// Calls send(event) with the conversation so far, then every new event. Returns unsubscribe.
export async function subscribe(id, send) {
  const run = await open(id);
  // History and listener in one step, so no event falls between them.
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

// Pi's own refusal (no model, pi gone) is shown to the user as it is.
const refused = (err) => {
  throw fail(409, err.message);
};

// A message: text, images and files. While a run is going, `steer` queues it into the run.
export async function prompt(id, { text = "", images = [], files = [] }) {
  if (typeof text !== "string") throw fail(400, "The message is not valid");
  const blocks = toImages(images);
  // Open first: no files are saved for an agent that does not exist.
  const { pi } = await open(id);
  const paths = await saveFiles(await getAgent(id), files);
  const message = [text.trim(), ...paths.map((path) => `[Attached file: ${path}]`)].filter(Boolean).join("\n\n");
  if (!message && !blocks.length) throw fail(400, "The message is empty");
  return pi.send("prompt", { message, images: blocks, streamingBehavior: "steer" }).catch(refused);
}

// What the agent's skills offer to run as /commands, from its own pi: [{ name, description }].
export async function skillCommands(id) {
  const { commands } = await (await open(id)).pi.send("get_commands").catch(refused);
  return commands.filter((c) => c.source === "skill").map((c) => ({ name: c.name.replace(/^skill:/, ""), description: c.description ?? "" }));
}

// How full the agent's context is, against the point where pi summarizes it: { tokens, window, point }, or null when pi does not
// know the model's window. `tokens` is null just after a summary, until the next reply tells (`after` overrides pi's count).
// The chat's ring fills as tokens reach `point`, so full means pi summarizes next.
async function usageOf(run, after) {
  const { contextUsage } = await run.pi.send("get_session_stats").catch(refused);
  if (!contextUsage?.contextWindow) return null;
  const window = contextUsage.contextWindow;
  return { tokens: after === undefined ? contextUsage.tokens : after, window, point: await pointOf((await getAgent(run.id)).model, window) };
}

export const contextOf = async (id) => usageOf(await open(id));

// Summarizes the conversation now, as pi's /compact does; `instructions` say what the summary should keep. Returns the context after it.
export async function compact(id, instructions) {
  if (instructions !== undefined && typeof instructions !== "string") throw fail(400, "The instructions are not valid");
  const run = await open(id);
  if (run.busy) throw fail(409, "Wait for the agent to finish, or stop it, then compact");
  const { estimatedTokensAfter } = await run.pi.send("compact", instructions?.trim() ? { customInstructions: instructions.trim() } : {}).catch(refused);
  return usageOf(run, estimatedTokensAfter ?? null);
}

// The tool the agent is using now ("" between tools); null when it is not in the middle of a run.
export const activityOf = (id) => {
  const run = runs.get(id);
  return run?.busy ? (run.doing ?? "") : null;
};

// The user's answer to the question the agent waits on; no `value` means the user skipped it.
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

// The daemon asks the user, in the agent's chat, as the agent's `ask` would (a choice of `options`): for what the agent may not
// decide alone. Only the user answers it (POST /api/agents/:id/answer is not the agent's). Resolves with the option chosen,
// or undefined when the question ends unanswered (skipped, the run stopped, the pi closed).
export async function askUser(id, title, options) {
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

// Applies a changed agent, skill or plugin, or reads the agent's files again (/reload), by starting its pi anew: now if the agent is idle, else when its run ends.
export async function restart(id) {
  const run = await current(id);
  if (run?.busy) run.stale = true;
  else await stop(id);
}

// Runs `job` (a move of the agent's folders) with its pi stopped, and none started until it is done.
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
