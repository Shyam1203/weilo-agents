import { BROWSER, fail, readJson, updateJson } from "../common.mjs";
import { DEFAULT_RULE, MAX_RULE } from "../config.mjs";

// Settings > Browser: whether agents must ask you first, and for what. The rule goes to every
// agent in its browser tool's description; it is a request to the agent, not a lock.

export async function getRule() {
  const saved = await readJson(BROWSER);
  return { ask: saved.ask !== false, rule: typeof saved.rule === "string" && saved.rule.trim() ? saved.rule.trim() : DEFAULT_RULE };
}

export async function saveRule({ ask, rule }) {
  if (typeof ask !== "boolean" || typeof rule !== "string" || rule.length > MAX_RULE) throw fail(400, "The settings are not valid");
  const saved = { ask, rule: rule.trim() || DEFAULT_RULE };
  await updateJson(BROWSER, () => saved);
  return saved;
}

/** What agents must ask about; empty when you turned it off. */
export const askBefore = async () => {
  const { ask, rule } = await getRule();
  return ask ? rule : "";
};
