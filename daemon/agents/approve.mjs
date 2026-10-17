import { getAgent, updateAgent } from "./agents.mjs";
import { askUser } from "./runner.mjs";

const ALWAYS = "Always allow";
export const ALLOWED_NOTE = " (always allowed)";

export async function approve(id, rule, question, options) {
  if ((await getAgent(id)).allow.includes(rule)) return { answer: options[0], always: true };
  const answer = await askUser(id, question, [...options.slice(0, -1), ALWAYS, options.at(-1)]);
  if (answer !== ALWAYS) return { answer, always: false };
  await updateAgent(id, (now) => ({ allow: [...new Set([...now.allow, rule])] }));
  return { answer: options[0], always: false };
}
