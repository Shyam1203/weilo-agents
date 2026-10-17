import { join } from "node:path";
import { AGENT_DIR, AUTH, fail, MODELS, readJson } from "../common.mjs";
import { PI_SDK, PORT } from "../config.mjs";
import { KEY_HEADERS } from "../http/access.mjs";
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

const FRESH = { minOAuthValidityMs: 5 * 60_000 };
const base64url = (data) => Buffer.from(JSON.stringify(data)).toString("base64url");
const CHATGPT_CLAIM = "https://api.openai.com/auth";

const accountOf = (jwt) => {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString())[CHATGPT_CLAIM]?.chatgpt_account_id ?? "";
  } catch {
    return "";
  }
};

const PLACEHOLDERS = {
  anthropic: (key) => `sk-ant-oat01-${key}`,
  openai: (key, real) => `${base64url({ alg: "none", typ: "JWT" })}.${base64url({ [CHATGPT_CLAIM]: { chatgpt_account_id: accountOf(real) } })}.${key}`,
  "github-copilot": (key, real) => `tid=weilo;${/proxy-ep=[^;]+/.exec(real)?.[0] ?? ""};weilo=${key}`,
};

const SIGN_IN_COMPAT = {
  openai: { supportsMaxOutputTokens: false, supportsMidConvoEffort: false, supportsLongCacheRetention: false, supportsExplicitPromptCacheMode: false },
};

export const placeholderFor = (provider, key, real) => (PLACEHOLDERS[provider] ?? ((k) => k))(key, real);

export async function piModels(model, key) {
  const provider = providerOf(model);
  const { apiKey: _key, headers: _headers, ...own } = (await readJson(MODELS)).providers?.[provider] ?? {};
  const models = await registry();
  const real = models.isUsingOAuth(provider) ? (await models.getAuth(provider, FRESH).catch(() => null))?.auth?.apiKey : "";
  const proxied = { ...own, baseUrl: `http://127.0.0.1:${PORT}/api/model-proxy/${provider}`, apiKey: real ? placeholderFor(provider, key, real) : key };
  return { providers: { [provider]: real && SIGN_IN_COMPAT[provider] ? { ...proxied, compat: { ...own.compat, ...SIGN_IN_COMPAT[provider] } } : proxied } };
}

export const swapKey = (text, key, real) => text.replace(new RegExp(`[^\\s,]*${key}[^\\s,]*`, "g"), () => real);

export const keyedHeaders = (headers, key, real) =>
  Object.fromEntries(Object.entries(headers).flatMap(([name, value]) => (KEY_HEADERS.includes(name) ? [[name, swapKey(value, key, real)]] : value.includes(key) ? [] : [[name, value]])));

export const forgetAuth = () => (made = 0);

export const warmModels = () => registry().then(() => {}, (err) => console.error("The model runtime cannot load:", err.message));

const API_PATHS = [
  ["anthropic-messages", /^\/v1\/messages/],
  ["openai-responses", /\/responses(\/|$)/],
  ["openai-completions", /\/chat\/completions$/],
  ["google-generative-ai", /\/models\/[^/]+:/],
];
function baseFor(models, path) {
  const bases = new Map();
  for (const m of models) if (m.baseUrl && !bases.has(m.api)) bases.set(m.api, m.baseUrl);
  const api = API_PATHS.find(([name, pattern]) => bases.has(name) && RegExp(pattern).test(path))?.[0];
  if (api) return bases.get(api);
  const count = new Map();
  for (const m of models) if (m.baseUrl) count.set(m.baseUrl, (count.get(m.baseUrl) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export async function proxyModel(req, res, { key, provider, rest, search }) {
  const models = await registry();
  const found = await models.getAuth(provider, FRESH);
  const real = found?.auth?.apiKey;
  if (!real) throw fail(502, `There is no key or sign-in for ${provider}. Add one in Settings.`);
  const base = found.auth.baseUrl ?? baseFor(models.getAllModels(provider), rest);
  if (!base) throw fail(502, `Unknown provider ${provider}`);
  const target = new URL(base.replace(/\/$/, "") + rest + search);
  if (target.searchParams.has("key")) target.searchParams.set("key", swapKey(target.searchParams.get("key"), key, real));
  await forward(req, res, target, { ...keyedHeaders(headersOf(req), key, real), ...found.auth.headers });
}
