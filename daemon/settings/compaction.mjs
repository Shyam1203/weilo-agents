import { readJson, SETTINGS, updateJson } from "../common.mjs";
import { COMPACT_AT, MIN_RESERVE } from "../config.mjs";

// Long conversations are summarized so they keep fitting, at COMPACT_AT of the model's window. Pi counts it the other way, as
// the tokens kept free (`reserveTokens`), per model: setReserves writes that for each model in use that has none of its own (a
// value set by hand stays), never less than MIN_RESERVE, which a reply needs. A value of ours for a model no longer in use is
// removed. pointOf reads it back: the tokens at which pi summarizes.

export async function pointOf(model, window) {
  const { compaction } = await readJson(SETTINGS).catch(() => ({}));
  const reserve = compaction?.modelOverrides?.[model]?.reserveTokens ?? compaction?.reserveTokens ?? MIN_RESERVE;
  return Math.max(window - reserve, 1);
}

// `models` are pi's available models; `enabledModels` the ones in use (none listed means all).
export async function setReserves(models, enabledModels) {
  const ours = {};
  for (const { provider, id, contextWindow } of models) {
    const key = `${provider}/${id}`;
    if (contextWindow) ours[key] = { reserveTokens: Math.max(Math.round(contextWindow * (1 - COMPACT_AT(contextWindow))), MIN_RESERVE), used: !enabledModels.length || enabledModels.includes(key) };
  }
  // Asking pi takes a while, and the settings may have changed meanwhile: the latest settings are used.
  await updateJson(SETTINGS, (settings) => {
    const current = settings.compaction?.modelOverrides ?? {};
    const modelOverrides = Object.fromEntries(Object.entries(current).filter(([key, value]) => ours[key]?.used || ours[key]?.reserveTokens !== value.reserveTokens));
    for (const [key, { reserveTokens, used }] of Object.entries(ours)) if (used && !modelOverrides[key]) modelOverrides[key] = { reserveTokens };
    return { ...settings, compaction: { ...settings.compaction, modelOverrides } };
  });
}
