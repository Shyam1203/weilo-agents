import { APP, fail, readJson, updateJson } from "./common.mjs";
import { RELEASES_URL, UPDATE_CACHE_MS, UPDATE_TIMEOUT_MS } from "./config.mjs";
import { BUILD } from "./version.mjs";

// Whether a newer release exists: the newest one on GitHub, asked at most every UPDATE_CACHE_MS, and only if the user
// has not turned the check off (weilo.json `checkUpdates`). A build made without a version ("dev") never asks. The app does not
// update itself: the user runs the start script again.
let cache = null; // { at, latest: { version, url } | null }
let asking = null; // the request in flight, shared by whoever asks meanwhile

// 1.2.3 (a leading v and a -suffix are ignored) as numbers.
const parts = (version) => String(version).replace(/^v/, "").split("-")[0].split(".").map(Number);
const newer = (a, b) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

function latest() {
  if (cache && Date.now() - cache.at < UPDATE_CACHE_MS) return cache.latest;
  return (asking ??= ask().finally(() => (asking = null)));
}

async function ask() {
  try {
    const res = await fetch(RELEASES_URL, { headers: { Accept: "application/vnd.github+json", "User-Agent": "weilo-agents" }, signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS) });
    if (!res.ok) throw fail(502, String(res.status));
    const { tag_name, html_url } = await res.json();
    cache = { at: Date.now(), latest: { version: String(tag_name).replace(/^v/, ""), url: html_url } };
  } catch {
    // Offline or rate limited: say nothing now, ask again in a while.
    cache = { at: Date.now() - UPDATE_CACHE_MS + 10 * 60_000, latest: cache?.latest ?? null };
  }
  return cache.latest;
}

/** { current, enabled, latest, url, available } */
export async function updateStatus() {
  const { checkUpdates = true } = await readJson(APP);
  const status = { current: BUILD.version, enabled: checkUpdates, latest: null, url: null, available: false };
  if (!checkUpdates || BUILD.version === "dev") return status;
  const found = await latest();
  return found ? { ...status, latest: found.version, url: found.url, available: newer(found.version, BUILD.version) } : status;
}

export async function setUpdateCheck({ enabled } = {}) {
  if (typeof enabled !== "boolean") throw fail(400, "The setting is not valid");
  await updateJson(APP, (data) => ({ ...data, checkUpdates: enabled }));
  return updateStatus();
}
