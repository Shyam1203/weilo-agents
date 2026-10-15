import { spawnPi } from "../agents/pi.mjs";
import { AGENT_DIR, AUTH, fail, PI_ENV, readJson, SETTINGS, updateJson } from "../common.mjs";
import { BIN, MODELS_TIMEOUT_MS, PROVIDERS } from "../config.mjs";
import { setReserves } from "./compaction.mjs";

// Provider keys are pi's own: agent/auth.json, { "<provider>": { "type": "api_key", "key": … } } (or "oauth" and tokens: login.mjs).
// Keys are only ever written here, never returned. Settings offers PROVIDERS (config.mjs) and any other in auth.json.

const check = (id) => {
  if (!/^[a-z0-9-]+$/.test(id)) throw fail(404, "This provider does not exist");
};

export async function listProviders() {
  const auth = await readJson(AUTH);
  // `account`: signed in with an account (settings/login.mjs), not a key.
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
  void syncCompaction();
}

export async function removeKey(id) {
  check(id);
  await updateJson(AUTH, ({ [id]: _removed, ...rest }) => rest);
}

// The models the saved keys can use, from a short-lived pi. A pi that does not answer is stopped. It runs as root, which
// holds the keys: in root's own folder, not in the workspace, where agents write.
async function availableModels() {
  const pi = spawnPi([BIN.pi, "--mode", "rpc", "--no-session", "--no-mcp", "--no-skills", "--no-extensions", "--no-context-files"], { cwd: AGENT_DIR, env: PI_ENV });
  let timer;
  const late = new Promise((_, reject) => (timer = setTimeout(() => reject(fail(504, "Pi did not list the models in time")), MODELS_TIMEOUT_MS)));
  try {
    return (await Promise.race([pi.send("get_available_models"), late])).models;
  } finally {
    clearTimeout(timer);
    pi.close();
  }
}

// The models, and which of them are enabled: pi's `enabledModels` setting, "provider/id" each.
// None enabled means all are.
export async function listModels() {
  const [{ enabledModels = [] }, models] = await Promise.all([readJson(SETTINGS), availableModels()]);
  return models.map(({ provider, id, name }) => ({ id: `${provider}/${id}`, name, enabled: enabledModels.includes(`${provider}/${id}`) }));
}

// Writes when pi summarizes long conversations (compaction.mjs) for the models in use.
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
  void syncCompaction();
}
