import { getAgent, updateAgent } from "./agents.mjs";
import { askUser } from "./runner.mjs";

export const ALWAYS = "Always allow";
export const ALLOWED_NOTE = " (always allowed)";

/**
 * Ask the user to approve a request of the kind `rule` names, unless they always allow it for this
 * agent. The last option is the no; "Always allow" goes before it, counts as the first option, and
 * saves the rule. Returns the answer, as one of the options, and whether it was allowed without asking.
 */
export async function approve(id, rule, question, options) {
  if ((await getAgent(id)).allow.includes(rule)) return { answer: options[0], always: true };
  const answer = await askUser(id, question, [...options.slice(0, -1), ALWAYS, options.at(-1)]);
  if (answer !== ALWAYS) return { answer, always: false };
  await updateAgent(id, (now) => ({ allow: [...new Set([...now.allow, rule])] }));
  return { answer: options[0], always: false };
}
