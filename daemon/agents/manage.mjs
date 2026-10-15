import { BUNDLED, fail } from "../common.mjs";
import { MAX_APPROVAL } from "../config.mjs";
import { checkAgent, createAgent, getAgent, isIsolated, profiles, updateAgent } from "./agents.mjs";
import { listExtensions } from "../settings/extensions.mjs";
import { listPlugins } from "../settings/plugins.mjs";
import { listSkills } from "../settings/skills.mjs";
import { askUser, restart } from "./runner.mjs";

// The `agents` tool: an agent lists the agents, and asks to make one or change one. Nothing is made or changed until the
// user approves it, in the chat of the agent that asked: the daemon asks the question itself (`askUser`), and only a
// paired device can answer it, so an agent cannot approve its own request. The question shows the whole change, and says
// what the new or changed agent would get that the asking agent does not have (another provider, plugins, extensions) or
// what it would reach (the browser, with its logins).
// - Who is isolated or trusted is the user's to say, in the app: no request sets it.
// - An isolated agent sees only itself and what it could ask for, and may ask only for what it uses (skills, plugins,
//   extensions), for itself. A regular agent may not change an isolated one: only the user changes those.
// - A trusted agent's change to itself of its instructions, thinking or skills applies without a question (none gives it
//   more reach than it has), with a line in the chat that says so.

const FIELDS = ["name", "instructions", "model", "thinking", "skills", "plugins", "extensions"];
const ISOLATED_FIELDS = ["skills", "plugins", "extensions"];
const TRUSTED_FIELDS = ["instructions", "thinking", "skills"];
const USER_ONLY = ["isolated", "trusted"];
const APPROVE = { create: "Create it", update: "Change it" };
const DECLINE = "Don't";

const pick = (body) => Object.fromEntries(FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, body[f]]));
const list = (items) => (items.length ? items.join(", ") : "none");
const providerOf = (model) => model.split("/")[0];

// An agent's extensions, as the tool names them: the bundled ones it has not turned off, and the added ones it uses.
export const extensionsIn = (agent) => [...Object.keys(BUNDLED).filter((id) => !agent.disabled.includes(id)), ...agent.extensions];
// A request's `extensions` (every extension the agent should have) as the profile keeps them.
const asProfile = ({ extensions, ...rest }) =>
  extensions === undefined ? rest : { ...rest, extensions: extensions.filter((id) => !Object.hasOwn(BUNDLED, id)), disabled: Object.keys(BUNDLED).filter((id) => !extensions.includes(id)) };

// Why `asker` may not ask this (`target`: the agent to change, for update), or nothing.
export function refusal(asker, action, target, body) {
  if (USER_ONLY.some((f) => body[f] !== undefined)) return "Only the user can make an agent isolated or trusted, in its settings.";
  if (isIsolated(asker)) {
    if (action === "create") return "An isolated agent cannot make agents.";
    if (action === "update" && target.id !== asker.id) return "An isolated agent can change only itself.";
    const other = Object.keys(pick(body)).find((f) => !ISOLATED_FIELDS.includes(f));
    if (action === "update" && other) return `An isolated agent can ask only for skills, plugins and extensions, not its ${other}.`;
  } else if (action === "update" && isIsolated(target)) return `${target.name} is isolated: only the user changes its settings.`;
  return null;
}

// Whether a change applies without asking the user: the asker trusts itself with it (the user said so), it is its own, and
// it touches only what gives it no more reach. (`known` has checked the skills are in the library.)
export const allowedAlways = (asker, target, patch) => asker.trusted === true && target.id === asker.id && Object.keys(patch).length > 0 && Object.keys(patch).every((f) => TRUSTED_FIELDS.includes(f));

// Skills, plugins and extensions by the names the library has.
async function known({ skills, plugins, extensions }) {
  if (![skills, plugins, extensions].every((names) => names === undefined || (Array.isArray(names) && names.every((n) => typeof n === "string")))) throw fail(400, "Give skills, plugins and extensions as lists of names.");
  const [haveSkills, havePlugins, haveExtensions] = await Promise.all([listSkills(), listPlugins(), listExtensions()]);
  const missing = [
    ...(skills ?? []).filter((s) => !haveSkills.some((h) => h.id === s)),
    ...(plugins ?? []).filter((p) => !havePlugins.some((h) => h.name === p)),
    ...(extensions ?? []).filter((x) => !haveExtensions.some((h) => h.id === x)),
  ];
  if (missing.length) throw fail(400, `There is no skill, plugin or extension ${list(missing)}. List the agents to see them.`);
}

// What `agent` would get that `asker` has not; and the browser, when `asker` has not, or `before` (the agent as it is, for a
// change) had not.
export function more(asker, agent, before) {
  const extra = [];
  if (providerOf(agent.model) !== providerOf(asker.model)) extra.push(`the provider ${providerOf(agent.model)}`);
  const plugins = agent.plugins.filter((p) => !asker.plugins.includes(p));
  if (plugins.length) extra.push(`the plugin${plugins.length > 1 ? "s" : ""} ${list(plugins)}`);
  const extensions = extensionsIn(agent).filter((x) => x !== "browser" && !extensionsIn(asker).includes(x));
  if (extensions.length) extra.push(`the extension${extensions.length > 1 ? "s" : ""} ${list(extensions)}`);
  const lines = extra.length ? [`It would get ${extra.join(" and ")}, which ${asker.name} does not have.`] : [];
  const browser = (a) => extensionsIn(a).includes("browser");
  if (browser(agent) && (!browser(asker) || (before && !browser(before)))) lines.push("It would get the browser, with the sign-ins of every site you are signed in to there.");
  return lines.map((line) => `\n${line}`).join("");
}

const describe = (agent) =>
  [`Model: ${agent.model}`, `Plugins: ${list(agent.plugins)}`, `Skills: ${list(agent.skills)}`, `Extensions: ${list(extensionsIn(agent))}`, ...(agent.instructions ? [`Instructions: ${agent.instructions}`] : [])].join("\n");

// The user approves what they read, so the question holds the whole change; one too long to read is refused, not cut.
const question = (text) => {
  if (text.length > MAX_APPROVAL) throw fail(400, `This request is too long to show the user in full (${text.length} characters; at most ${MAX_APPROVAL}). Make it shorter.`);
  return text;
};

// An agent by its id or its name.
async function find(which) {
  const all = await profiles();
  const agent = all.find((a) => a.id === which) ?? all.find((a) => a.name.toLowerCase() === String(which ?? "").toLowerCase());
  if (!agent) throw fail(404, `There is no agent "${which}". List the agents to see their names.`);
  return agent;
}

const line = (a, id) => `- ${a.name} (id ${a.id}${a.id === id ? ", you" : ""}${isIsolated(a) ? ", isolated" : ""}): ${a.model}; plugins: ${list(a.plugins)}; skills: ${list(a.skills)}; extensions: ${list(extensionsIn(a))}`;

async function catalog() {
  const [skills, plugins, extensions] = await Promise.all([listSkills(), listPlugins(), listExtensions()]);
  return [
    `Skills in the library: ${list(skills.map((s) => `${s.id} (${s.description.slice(0, 200)})`))}`,
    `Plugins: ${list(plugins.map((p) => p.name))}`,
    `Extensions: ${list(extensions.map((x) => `${x.id} (${x.description.slice(0, 200)})`))}`,
  ];
}

export async function manageAgents(id, { action, agent: which, ...body }) {
  const asker = await getAgent(id);
  if (action === "list") {
    // An isolated agent sees no other agent.
    const all = isIsolated(asker) ? [asker] : await profiles();
    return { text: ["Agents:", ...all.map((a) => line(a, id)), ...(await catalog())].join("\n") };
  }
  if (action === "create") {
    const refused = refusal(asker, action, null, body);
    if (refused) throw fail(403, refused);
    // A new agent has the asker's model unless the request names another; it is never isolated or trusted.
    const request = pick(body);
    await known(request);
    const input = { model: asker.model, ...asProfile(request) };
    const agent = await checkAgent(input);
    const answer = await askUser(id, question(`${asker.name} asks to create an agent: ${agent.name}\n${describe(agent)}${more(asker, agent)}`), [APPROVE.create, DECLINE]);
    if (answer !== APPROVE.create) return { text: "The user did not approve it: no agent was made." };
    const made = await createAgent(input);
    return { text: `Made the agent ${made.name} (id ${made.id}). It shows in the user's agent list.` };
  }
  if (action === "update") {
    // An isolated agent changes only itself: it need not (and cannot) name another.
    const target = isIsolated(asker) && which === undefined ? asker : await find(which);
    const refused = refusal(asker, action, target, body);
    if (refused) throw fail(403, refused);
    const request = pick(body);
    if (!Object.keys(request).length) throw fail(400, "Say what to change.");
    await known(request);
    const patch = asProfile(request);
    const after = await checkAgent({ ...target, ...patch });
    const self = target.id === id;
    const shown = (f) => (f === "extensions" ? extensionsIn(after) : after[f]);
    const changes = Object.keys(request).map((f) => `${f[0].toUpperCase()}${f.slice(1)}: ${Array.isArray(shown(f)) ? list(shown(f)) : String(shown(f))}`).join("\n");
    const always = allowedAlways(asker, target, request);
    if (!always) {
      const answer = await askUser(id, question(`${asker.name} asks to change ${self ? "itself" : target.name}:\n${changes}${more(asker, after, target)}`), [APPROVE.update, DECLINE]);
      if (answer !== APPROVE.update) return { text: "The user did not approve it: nothing was changed." };
    }
    await updateAgent(target.id, patch);
    // Its pi starts again with the change: the asking agent's own once this reply ends.
    await restart(target.id);
    const text = self ? "Changed. It applies from your next message." : `Changed ${target.name}.`;
    // `details`: the chat shows a line, so the user sees what changed without being asked.
    return always ? { text, details: { note: `Changed its own ${Object.keys(request).join(" and ")} (always allowed)` } } : { text };
  }
  throw fail(400, "Use list, create or update.");
}
