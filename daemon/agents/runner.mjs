import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fail, PI_ENV, SESSIONS, WORKSPACE } from "../common.mjs";
import { CORE_TOOLS, IDLE_MS, PI_BUILTINS, PI_TOOLS, PORT } from "../config.mjs";
import { askBefore } from "../browser/rule.mjs";
import { memoryFlags } from "../memory/memory.mjs";
import { pointOf } from "../settings/compaction.mjs";
import { extensionsOf } from "../settings/extensions.mjs";
import { pluginTools } from "../settings/plugins.mjs";
import { skillPaths } from "../settings/skills.mjs";
import { userFlags } from "../settings/user.mjs";
import { getAgent, profilePath } from "./agents.mjs";
import { spawnPi } from "./pi.mjs";
import { asTyped } from "./sessions.mjs";
import { saveFiles, toImages } from "./uploads.mjs";

// One pi per agent that is open. It starts on first use and stops after IDLE_MS with nobody
// watching and no run in progress.
// agent id -> run: { id, ready: Promise<run>, pi, listeners, busy, doing, asking, stale, timer, done }
// `asking` is the question the agent waits on, as pi sent it (`extension_ui_request`).
const runs = new Map();

const emit = (run, event) => run.listeners.forEach((send) => send(event));

// The agent's question is over (answered, or the run went on without it).
const endAsk = (run) => {
  if (!run.asking) return;
  const { id } = run.asking;
  run.asking = null;
  emit(run, { type: "ask_end", id });
};

// A closing run leaves `runs` at once, so the next viewer or message starts a new pi.
const close = (run) => {
  if (runs.get(run.id) === run) runs.delete(run.id);
  clearTimeout(run.timer);
  run.pi?.close();
};

const touch = (run) => {
  clearTimeout(run.timer);
  // A run that closed already needs no timer (a viewer can leave after it closed).
  if (run.busy || run.listeners.size || runs.get(run.id) !== run) return;
  run.timer = setTimeout(() => close(run), IDLE_MS).unref();
};

// Our extensions, which give every agent the chat's tools and memory.
const CORE_EXTENSIONS = ["../weilo.mjs", "../memory/extension.mjs"].map((path) => fileURLToPath(new URL(path, import.meta.url)));

// The tools an agent may call, as pi's allowlist: pi's built-in ones, our tools, its extensions' and its plugins'. With no plugin, MCP is off.
const toolsFlags = (plugins, extensions) => {
  const tools = [...PI_TOOLS, ...CORE_TOOLS, ...extensions.flatMap((e) => e.tools)];
  return plugins.length ? ["--tools", [...tools, "codemode", ...plugins].join(",")] : ["--no-mcp", "--tools", tools.join(",")];
};

// pi's command line for an agent: its profile (which holds its instructions), what it knows about you and remembers, model, thinking level, the extensions it loads (pi's built-in ones, the app's that it has not turned off, and the ones it uses), skills and plugins, and its one conversation.
const argvOf = (agent, skills, plugins, extensions, about) => {
  const { id, model, thinking } = agent;
  return [
    "pi", "--mode", "rpc",
    ...(model ? ["--model", model] : []),
    ...(thinking ? ["--thinking", thinking] : []),
    "--append-system-prompt", profilePath(id),
    ...about,
    "-ne", ...PI_BUILTINS.flatMap((name) => ["-e", `builtin:${name}`]),
    ...CORE_EXTENSIONS.flatMap((path) => ["-e", path]), ...extensions.flatMap((e) => ["-e", e.entry]),
    "--no-skills", ...skills.flatMap((path) => ["--skill", path]),
    ...toolsFlags(plugins, extensions),
    "--session-dir", join(SESSIONS, id),
    "--session-id", id,
  ];
};

async function start(run) {
  const agent = await getAgent(run.id);
  const [ask, skills, plugins, extensions, user, memory] = await Promise.all([askBefore(), skillPaths(agent.skills), pluginTools(agent.plugins), extensionsOf(agent), userFlags(), memoryFlags()]);
  const argv = argvOf(agent, skills, plugins, extensions, [...user, ...memory]);
  run.done = new Promise((resolve) => {
    run.pi = spawnPi(argv, {
      cwd: WORKSPACE,
      env: { ...PI_ENV, WEILO_AGENT: run.id, WEILO_API: `http://127.0.0.1:${PORT}/api`, WEILO_ASK_BEFORE: ask },
      onEvent(event) {
        if (event.type === "agent_start") run.busy = true;
        if (event.type === "agent_settled") run.busy = false;
        if (event.type === "tool_execution_start") run.doing = event.toolName;
        if (event.type === "tool_execution_end" || !run.busy) run.doing = "";
        if (event.type === "extension_ui_request") {
          // Only the agent's own questions (`ask`: a choice or a line of text) reach the user; pi may ask others.
          if (event.method === "select" || event.method === "input") run.asking = event;
          else if (event.method === "confirm" || event.method === "editor") run.pi.reply({ type: "extension_ui_response", id: event.id, cancelled: true });
        }
        if (event.type === "tool_execution_end" || !run.busy) endAsk(run);
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
  const paths = await saveFiles(files);
  const message = [text.trim(), ...paths.map((path) => `[Attached file: ${path}]`)].filter(Boolean).join("\n\n");
  if (!message && !blocks.length) throw fail(400, "The message is empty");
  return pi.send("prompt", { message, images: blocks, streamingBehavior: "steer" }).catch(refused);
}

// What the agent's skills offer to run as /commands, from its own pi: [{ name, description }].
export async function skillCommands(id) {
  const { commands } = await (await open(id)).pi.send("get_commands").catch(refused);
  return commands.filter((c) => c.source === "skill").map((c) => ({ name: c.name.replace(/^skill:/, ""), description: c.description ?? "" }));
}

// How full the agent's context is, against the point where pi summarizes it: { tokens, window, point }. `tokens` is null just
// after a summary, until the next reply tells. The chat's ring fills as tokens reach `point`, so full means pi summarizes next.
const usageOf = async (id, tokens, window) => ({ tokens, window, point: await pointOf((await getAgent(id)).model, window) });

export async function contextOf(id) {
  const { contextUsage } = await (await open(id)).pi.send("get_session_stats").catch(refused);
  return contextUsage?.contextWindow ? usageOf(id, contextUsage.tokens, contextUsage.contextWindow) : null;
}

// Summarizes the conversation now, as pi's /compact does; `instructions` say what the summary should keep. Returns the context after it.
export async function compact(id, instructions) {
  if (instructions !== undefined && typeof instructions !== "string") throw fail(400, "The instructions are not valid");
  const run = await open(id);
  if (run.busy) throw fail(409, "Wait for the agent to finish, or stop it, then compact");
  const { estimatedTokensAfter } = await run.pi.send("compact", instructions?.trim() ? { customInstructions: instructions.trim() } : {}).catch(refused);
  const { contextUsage } = await run.pi.send("get_session_stats").catch(refused);
  return contextUsage?.contextWindow ? usageOf(id, estimatedTokensAfter ?? null, contextUsage.contextWindow) : null;
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
  run.pi.reply({ type: "extension_ui_response", id: request, ...(value === undefined ? { cancelled: true } : { value }) });
  endAsk(run);
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

export const restartAll = () => Promise.all([...runs.keys()].map(restart));

export const stopAll = () => Promise.all([...runs.keys()].map(stop));
