import type { Agent } from "../api/agents";
import { choosableOf, shortName, type Model, type Provider } from "../api/providers";

// Small, preview and special-purpose models are not a good first choice for an agent that does real work.
const NOT_FIRST = /mini|nano|lite|haiku|flash|preview|spark|deep-research|computer-use|embed|image|audio|tts|realtime|classifier|\d{8}/i;
// The balanced tier: capable, and cheaper than the largest models.
const BALANCED = /sonnet/i;

const versionOf = (id: string) => {
  const name = id.split("/").at(-1) ?? id;
  const [, major = "0", minor = "0"] = /(\d+)(?:[.-](\d+))?/.exec(name) ?? [];
  return Number(major) + Number(minor) / 100;
};

/**
 * The model a new agent starts with: what your agents use most, or else a current, capable model of the
 * first connected provider. You can always change it.
 */
export function recommendedModel(models: Model[] | undefined, providers: Provider[], agents: Pick<Agent, "model">[] = []): string {
  if (!models?.length) return "";
  const known = new Set(models.map((m) => m.id));
  const counts = new Map<string, number>();
  for (const { model } of agents) if (known.has(model)) counts.set(model, (counts.get(model) ?? 0) + 1);
  const used = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (used) return used;
  for (const provider of providers.filter((p) => p.connected)) {
    const choosable = choosableOf(models, provider.id);
    const good = choosable.filter((m) => !NOT_FIRST.test(m.id));
    const pool = good.length ? good : choosable;
    const best = [...pool].sort((a, b) => Number(BALANCED.test(b.id)) - Number(BALANCED.test(a.id)) || versionOf(b.id) - versionOf(a.id))[0];
    if (best) return best.id;
  }
  return "";
}

/** Every model an agent can be given, across the connected providers, for a picker. */
export const modelChoices = (models: Model[] | undefined, providers: Provider[]) => {
  const connected = providers.filter((p) => p.connected);
  return connected.flatMap((p) => choosableOf(models ?? [], p.id).map((m) => ({ value: m.id, label: connected.length > 1 ? `${p.name} · ${shortName(m.name)}` : shortName(m.name) })));
};
