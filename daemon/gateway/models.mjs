import { join } from "node:path";
import { AGENT_DIR, AUTH, fail, MODELS, readJson } from "../common.mjs";
import { PI_SDK, PORT } from "../config.mjs";
import { forward, headersOf } from "./forward.mjs";

let runtime;
let made = 0;
async function registry() {
  if (!runtime || Date.now() - made > 60_000) {
    const { ModelRuntime } = await import(PI_SDK);
    runtime = await ModelRuntime.create({ authPath: AUTH, modelsPath: MODELS, modelsStorePath: join(AGENT_DIR, "models-store.json"), allowModelNetwork: false });
    made = Date.now();
  }
  return runtime;
}

export const providerOf = (model) => model.split("/")[0];

export const usesSignIn = async (model) => (await registry()).isUsingOAuth(providerOf(model));

export async function piModels(model, key) {
  const provider = providerOf(model);
  const { apiKey: _key, headers: _headers, ...own } = (await readJson(MODELS)).providers?.[provider] ?? {};
  const oauth = (await registry()).isUsingOAuth(provider);
  const route = oauth ? { apiKey: `!node /app/gateway/key.mjs ${provider}` } : { baseUrl: `http://127.0.0.1:${PORT}/api/model-proxy/${provider}`, apiKey: key };
  return { providers: { [provider]: { ...own, ...route } } };
}

export async function accessToken(provider) {
  const models = await registry();
  if (!models.isUsingOAuth(provider)) throw fail(404, "This provider has no sign-in");
  const found = await models.getAuth(provider, { minOAuthValidityMs: 5 * 60_000 });
  if (!found?.auth?.apiKey) throw fail(409, `Sign in to ${provider} again in Settings`);
  return found.auth.apiKey;
}

/** @type {[string, RegExp][]} */
const API_PATHS = [
  ["anthropic-messages", /^\/v1\/messages/],
  ["openai-responses", /\/responses(\/|$)/],
  ["openai-completions", /\/chat\/completions$/],
  ["google-generative-ai", /\/models\/[^/]+:/],
];
function baseFor(models, path) {
  const bases = new Map();
  for (const m of models) if (m.baseUrl && !bases.has(m.api)) bases.set(m.api, m.baseUrl);
  const api = API_PATHS.find(([name, pattern]) => bases.has(name) && pattern.test(path))?.[0];
  if (api) return bases.get(api);
  const count = new Map();
  for (const m of models) if (m.baseUrl) count.set(m.baseUrl, (count.get(m.baseUrl) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export async function proxyModel(req, res, { key, provider, rest, search }) {
  const models = await registry();
  const found = await models.getAuth(provider);
  const real = found?.auth?.apiKey;
  if (!real) throw fail(502, `There is no key for ${provider}. Add one in Settings.`);
  const base = baseFor(models.getAllModels(provider), rest);
  if (!base) throw fail(502, `Unknown provider ${provider}`);
  const target = new URL(base.replace(/\/$/, "") + rest + search);
  if (target.searchParams.has("key")) target.searchParams.set("key", target.searchParams.get("key").replaceAll(key, real));
  await forward(req, res, target, { ...headersOf(req, [], (value) => value.replaceAll(key, real)), ...found.auth.headers });
}
