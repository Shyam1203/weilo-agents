import { fail, KEYS, readJson, updateJson } from "../common.mjs";
import { KEY_SHOWN, KEY_TIMEOUT_MS, MAX_KEY_BODY, MAX_KEY_RESPONSE, MAX_KEY_VALUE, MAX_KEYS } from "../config.mjs";
import { getAgent } from "./agents.mjs";
import { askUser } from "./runner.mjs";

const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const HEADER = /^[A-Za-z0-9-]{1,64}$/;
const AUTHS = ["bearer", "header", "basic"];
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const OWN_HEADERS = new Set(["authorization", "cookie", "host", "content-length", "proxy-authorization"]);

const keysOf = async (agentId) => (await readJson(KEYS))[agentId] ?? {};

export const listKeys = async (agentId) => Object.entries(await keysOf(agentId)).map(([name, k]) => ({ name, origin: k.origin, saved: k.saved }));

export async function removeKey(agentId, name) {
  if (!Object.hasOwn(await keysOf(agentId), name)) throw fail(404, "This key does not exist");
  await updateJson(KEYS, (data) => {
    const mine = { ...data[agentId] };
    delete mine[name];
    return { ...data, [agentId]: mine };
  });
}

export const forgetKeys = (agentId) =>
  updateJson(KEYS, (data) => {
    const rest = { ...data };
    delete rest[agentId];
    return rest;
  });

function originOf(site) {
  let url;
  try {
    url = new URL(String(site ?? ""));
  } catch {
    throw fail(400, "Give site as an https:// address, like https://api.example.com");
  }
  if (url.protocol !== "https:") throw fail(400, "A key is sent only to an https:// site");
  return url.origin;
}

function authOf(options) {
  const { auth = "bearer", header, username } = options;
  if (!AUTHS.includes(auth)) throw fail(400, `Give auth as ${AUTHS.join(", ")}`);
  if (auth === "header" && !HEADER.test(String(header ?? ""))) throw fail(400, 'With auth "header", give header: the header\'s name, like X-Api-Key');
  if (auth === "basic" && (typeof username !== "string" || !username.trim())) throw fail(400, 'With auth "basic", give username (the key is the password)');
  return auth === "header" ? { type: auth, header } : auth === "basic" ? { type: auth, username: username.trim() } : { type: auth };
}

const headerFor = (auth, value) =>
  auth.type === "header" ? { [auth.header]: value } : { authorization: auth.type === "basic" ? `Basic ${Buffer.from(`${auth.username}:${value}`).toString("base64")}` : `Bearer ${value}` };

function redact(text, auth, value) {
  const forms = [value, encodeURIComponent(value), Buffer.from(value).toString("base64"), ...(auth.type === "basic" ? [Buffer.from(`${auth.username}:${value}`).toString("base64")] : [])];
  return forms.filter((form) => form.length >= 4).sort((a, b) => b.length - a.length).reduce((out, form) => out.split(form).join("[key]"), text);
}

async function ask(agentId, args) {
  const { name, site, label, ...rest } = args;
  if (!NAME.test(String(name ?? ""))) throw fail(400, "Give name: short, lowercase, like weather_api");
  const origin = originOf(site);
  const auth = authOf(rest);
  const mine = await keysOf(agentId);
  const was = mine[name];
  if (was && (was.origin !== origin || JSON.stringify(was.auth) !== JSON.stringify(auth))) throw fail(409, `A key named "${name}" is saved for ${was.origin} with other settings. Use another name, or forget it first.`);
  if (was && rest.replace !== true) return { text: `The key "${name}" is saved already. Use it with action use. To have the user enter it again, ask with replace: true.` };
  if (!was && Object.keys(mine).length >= MAX_KEYS) throw fail(400, `An agent can keep ${MAX_KEYS} keys. Forget one first.`);
  const agent = await getAgent(agentId);
  const what = typeof label === "string" && label.trim() ? `: ${label.trim().slice(0, 200)}` : "";
  const value = await askUser(agentId, `${agent.name} asks for a key for ${new URL(origin).host}${what}`, [], { secret: true });
  if (typeof value !== "string" || !value.trim()) return { text: "The user did not give the key. Do not ask again unless they ask you to." };
  if (value.trim().length > MAX_KEY_VALUE) throw fail(400, `That key is too long: ${MAX_KEY_VALUE} characters at most.`);
  await updateJson(KEYS, (data) => ({ ...data, [agentId]: { ...data[agentId], [name]: { origin, auth, value: value.trim(), saved: new Date().toISOString() } } }));
  return { text: `Saved the key "${name}" for ${origin}. Use it with action use: the app adds it to your request. You never see it.`, details: { note: `Key saved: ${name}` } };
}

async function use(agentId, args) {
  const { name, url, method = "GET", body, headers = {} } = args;
  const key = (await keysOf(agentId))[name];
  if (!key) throw fail(404, `There is no key "${name}". List the keys, or ask the user for it.`);
  let target;
  try {
    target = new URL(String(url ?? ""));
  } catch {
    throw fail(400, "Give url: the whole address of the request");
  }
  if (target.origin !== key.origin) throw fail(403, `The key "${name}" is only for ${key.origin}.`);
  const verb = String(method).toUpperCase();
  if (!METHODS.includes(verb)) throw fail(400, `Give method as ${METHODS.join(", ")}`);
  if (typeof headers !== "object" || headers === null || !Object.values(headers).every((v) => typeof v === "string")) throw fail(400, "Give headers as names and text values");
  const sent = Object.fromEntries(Object.entries(headers).filter(([h]) => !OWN_HEADERS.has(h.toLowerCase()) && h.toLowerCase() !== key.auth.header?.toLowerCase()));
  const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  if (payload !== undefined && typeof body !== "string" && !Object.keys(sent).some((h) => h.toLowerCase() === "content-type")) sent["content-type"] = "application/json";
  if (payload && Buffer.byteLength(payload) > MAX_KEY_BODY) throw fail(413, "The body is too large");
  const res = await fetch(target, { method: verb, headers: { ...sent, ...headerFor(key.auth, key.value) }, body: verb === "GET" ? undefined : payload, redirect: "manual", signal: AbortSignal.timeout(KEY_TIMEOUT_MS) }).catch((err) => {
    throw fail(502, `The request did not go through: ${err.name === "TimeoutError" ? `no answer in ${KEY_TIMEOUT_MS / 1000} seconds` : err.message}`);
  });
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    return { text: `HTTP ${res.status}: it sends you to ${res.headers.get("location") ?? "another address"}. A key is not sent on to another address: make the request there yourself if it is on ${key.origin}.` };
  }
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.length;
    text += decoder.decode(chunk, { stream: true });
    if (size > MAX_KEY_RESPONSE) break;
  }
  const out = redact(text, key.auth, key.value);
  const cut = out.length > KEY_SHOWN || size > MAX_KEY_RESPONSE ? `${out.slice(0, KEY_SHOWN)}\n(The answer is longer; this is its start.)` : out;
  return { text: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}\n\n${cut}` };
}

export async function keyTool(agentId, { action, ...args }) {
  if (action === "list") {
    const keys = await keysOf(agentId);
    const lines = Object.entries(keys).map(([name, k]) => `- ${name}: ${k.origin} (${k.auth.type}${k.auth.header ? ` ${k.auth.header}` : ""})`);
    return { text: lines.length ? lines.join("\n") : "No keys yet." };
  }
  if (action === "ask") return ask(agentId, args);
  if (action === "use") return use(agentId, args);
  if (action === "forget") {
    await removeKey(agentId, args.name);
    return { text: `Forgot the key "${args.name}".`, details: { note: `Key removed: ${args.name}` } };
  }
  throw fail(400, "Use ask, use, list or forget.");
}
