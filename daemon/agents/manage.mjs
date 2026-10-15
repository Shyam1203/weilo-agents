import { fail } from "../common.mjs";
import { checkAgent, createAgent, getAgent, profiles, updateAgent } from "./agents.mjs";
import { listPlugins } from "../settings/plugins.mjs";
import { listSkills } from "../settings/skills.mjs";
import { askUser, restart } from "./runner.mjs";

// The `agents` tool: an agent lists the agents, and asks to make one or change one. Nothing is made or changed until the
// user approves it, in the chat of the agent that asked: the daemon asks the question itself (`askUser`), and only a
// paired device can answer it, so an agent cannot approve its own request. The question says what the new or changed agent
// would get that the asking agent does not have (another provider, plugins).

const FIELDS = ["name", "instructions", "model", "thinking", "skills", "plugins"];
const APPROVE = { create: "Create it", update: "Change it" };
const DECLINE = "Don't";

const pick = (body) => Object.fromEntries(FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, body[f]]));
const list = (items) => (items.length ? items.join(", ") : "none");
const providerOf = (model) => model.split("/")[0];
// Instructions are shown in full, up to this long: the user approves what they read.
const SHOWN = 2000;
const clip = (text) => (text.length > SHOWN ? `${text.slice(0, SHOWN)}… (${text.length - SHOWN} more characters)` : text);

// Skills and plugins by the names the library has.
async function known({ skills, plugins }) {
  const [haveSkills, havePlugins] = await Promise.all([listSkills(), listPlugins()]);
  const missing = [...(skills ?? []).filter((s) => !haveSkills.some((h) => h.id === s)), ...(plugins ?? []).filter((p) => !havePlugins.some((h) => h.name === p))];
  if (missing.length) throw fail(400, `There is no skill or plugin ${list(missing)}. List the agents to see them.`);
}

// What `agent` would get that `asker` has not.
function more(asker, agent) {
  const extra = [];
  if (providerOf(agent.model) !== providerOf(asker.model)) extra.push(`the provider ${providerOf(agent.model)}`);
  const plugins = agent.plugins.filter((p) => !asker.plugins.includes(p));
  if (plugins.length) extra.push(`the plugin${plugins.length > 1 ? "s" : ""} ${list(plugins)}`);
  return extra.length ? `\nIt would get ${extra.join(" and ")}, which ${asker.name} does not have.` : "";
}

const describe = (agent) => [`Model: ${agent.model}`, `Plugins: ${list(agent.plugins)}`, `Skills: ${list(agent.skills)}`, ...(agent.instructions ? [`Instructions: ${clip(agent.instructions)}`] : [])].join("\n");

// An agent by its id or its name.
async function find(which) {
  const all = await profiles();
  const agent = all.find((a) => a.id === which) ?? all.find((a) => a.name.toLowerCase() === String(which ?? "").toLowerCase());
  if (!agent) throw fail(404, `There is no agent "${which}". List the agents to see their names.`);
  return agent;
}

export async function manageAgents(id, { action, agent: which, ...body }) {
  const asker = await getAgent(id);
  if (action === "list") {
    const all = await profiles();
    const [skills, plugins] = await Promise.all([listSkills(), listPlugins()]);
    return {
      text: [
        "Agents:",
        ...all.map((a) => `- ${a.name} (id ${a.id}${a.id === id ? ", you" : ""}): ${a.model}; plugins: ${list(a.plugins)}; skills: ${list(a.skills)}`),
        `Skills in the library: ${list(skills.map((s) => `${s.id} (${s.description.slice(0, 80)})`))}`,
        `Plugins: ${list(plugins.map((p) => p.name))}`,
      ].join("\n"),
    };
  }
  if (action === "create") {
    // A new agent has the asker's model unless the request names another.
    const input = { model: asker.model, ...pick(body) };
    await known(input);
    const agent = await checkAgent(input);
    const answer = await askUser(id, `${asker.name} asks to create an agent: ${agent.name}\n${describe(agent)}${more(asker, agent)}`, [APPROVE.create, DECLINE]);
    if (answer !== APPROVE.create) return { text: "The user did not approve it: no agent was made." };
    const made = await createAgent(input);
    return { text: `Made the agent ${made.name} (id ${made.id}). It shows in the user's agent list.` };
  }
  if (action === "update") {
    const target = await find(which);
    const patch = pick(body);
    if (!Object.keys(patch).length) throw fail(400, "Say what to change.");
    await known(patch);
    const after = await checkAgent({ ...target, ...patch });
    const changes = Object.keys(patch).map((f) => `${f[0].toUpperCase()}${f.slice(1)}: ${Array.isArray(after[f]) ? list(after[f]) : clip(String(after[f]))}`).join("\n");
    const whose = target.id === id ? "itself" : target.name;
    const answer = await askUser(id, `${asker.name} asks to change ${whose}:\n${changes}${more(asker, after)}`, [APPROVE.update, DECLINE]);
    if (answer !== APPROVE.update) return { text: "The user did not approve it: nothing was changed." };
    await updateAgent(target.id, patch);
    // Its pi starts again with the change: the asking agent's own once this reply ends.
    await restart(target.id);
    return { text: target.id === id ? "Changed. It applies from your next message." : `Changed ${target.name}.` };
  }
  throw fail(400, "Use list, create or update.");
}
