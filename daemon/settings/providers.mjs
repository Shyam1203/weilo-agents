import { spawn } from "node:child_process";
import { piRpc } from "../agents/pi.mjs";
import { AGENT_DIR, AUTH, fail, PI_ENV, readJson, SETTINGS, updateJson } from "../common.mjs";
import { BIN, MODELS_FOR_MS, MODELS_TIMEOUT_MS, PROVIDERS } from "../config.mjs";
import { forgetAuth } from "../gateway/models.mjs";
import { setReserves } from "./compaction.mjs";

const check = (id) => {
  if (!/^[a-z0-9-]+$/.test(id)) throw fail(404, "This provider does not exist");
};

export async function listProviders() {
  const auth = await readJson(AUTH);
  const known = PROVIDERS.map((p) => ({ ...p, connected: Object.hasOwn(auth, p.id), account: auth[p.id]?.type === "oauth" }));
  const others = Object.keys(auth)
    .filter((id) => !PROVIDERS.some((p) => p.id === id))
    .map((id) => ({ id, name: id, connected: true, account: auth[id]?.type === "oauth" }));
  return [...known, ...others];
}

export async function saveKey(id, key) {
  check(id);
  if (typeof key !== "string" || !key.trim()) throw fail(400, "Type a key");
  await updateJson(AUTH, (auth) => ({ ...auth, [id]: { type: "api_key", key: key.trim() } }));
  forgetModels();
  void syncCompaction();
}

export async function removeKey(id) {
  check(id);
  await updateJson(AUTH, ({ [id]: _removed, ...rest }) => rest);
  forgetModels();
}

let cache = null;
export const forgetModels = () => {
  cache = null;
  forgetAuth();
};

export function availableModels() {
  if (!cache || Date.now() - cache.at > MODELS_FOR_MS) cache = { at: Date.now(), list: askModels().catch((err) => ((cache = null), Promise.reject(err))) };
  return cache.list;
}

async function askModels() {
  const pi = piRpc(spawn(BIN.pi, ["--mode", "rpc", "--no-session", "--no-mcp", "--no-skills", "--no-extensions", "--no-context-files"], { cwd: AGENT_DIR, env: { ...process.env, ...PI_ENV } }));
  let timer;
  const late = new Promise((_, reject) => (timer = setTimeout(() => reject(fail(504, "Pi did not list the models in time")), MODELS_TIMEOUT_MS)));
  try {
    return (await Promise.race([pi.send("get_available_models"), late])).models;
  } finally {
    clearTimeout(timer);
    pi.close();
  }
}

export async function listModels() {
  const [{ enabledModels = [] }, models] = await Promise.all([readJson(SETTINGS), availableModels()]);
  return models.map(({ provider, id, name }) => ({ id: `${provider}/${id}`, name, enabled: enabledModels.includes(`${provider}/${id}`) }));
}

export async function syncCompaction() {
  try {
    const { enabledModels = [] } = await readJson(SETTINGS);
    await setReserves(await availableModels(), enabledModels);
  } catch (err) {
    console.error("Could not set when conversations are summarized:", err.message);
  }
}

export async function setEnabledModels(ids) {
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) throw fail(400, "The model list is not valid");
  await updateJson(SETTINGS, (settings) => ({ ...settings, enabledModels: ids }));
  forgetModels();
  void syncCompaction();
}
