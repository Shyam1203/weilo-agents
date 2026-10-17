import { readJson, SETTINGS, updateJson } from "../common.mjs";
import { COMPACT_POINT, MIN_RESERVE, OLD_COMPACT_AT } from "../config.mjs";

export async function pointOf(model, window) {
  const { compaction } = await readJson(SETTINGS).catch(() => ({}));
  const reserve = compaction?.modelOverrides?.[model]?.reserveTokens ?? compaction?.reserveTokens ?? MIN_RESERVE;
  return Math.max(window - reserve, 1);
}

export const reserveFor = (window) => Math.max(window - COMPACT_POINT(window), MIN_RESERVE);
const oldReserveFor = (window) => Math.max(Math.round(window * (1 - OLD_COMPACT_AT(window))), MIN_RESERVE);

export async function setReserves(models, enabledModels) {
  const ours = {};
  for (const { provider, id, contextWindow } of models) {
    const key = `${provider}/${id}`;
    if (contextWindow) ours[key] = { reserveTokens: reserveFor(contextWindow), old: oldReserveFor(contextWindow), used: !enabledModels.length || enabledModels.includes(key) };
  }
  await updateJson(SETTINGS, (settings) => {
    const current = settings.compaction?.modelOverrides ?? {};
    const written = (key, value) => ours[key] && [ours[key].reserveTokens, ours[key].old].includes(value.reserveTokens);
    const modelOverrides = Object.fromEntries(Object.entries(current).filter(([key, value]) => !written(key, value)));
    for (const [key, { reserveTokens, used }] of Object.entries(ours)) if (used && !modelOverrides[key]) modelOverrides[key] = { reserveTokens };
    return { ...settings, compaction: { ...settings.compaction, modelOverrides } };
  });
}
