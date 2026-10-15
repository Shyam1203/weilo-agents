import { createHash, randomBytes, randomInt } from "node:crypto";
import { DEVICES, fail, readJson, updateJson } from "../common.mjs";
import { DEVICE_COOKIE_S, DEVICE_SEEN_MS, PAIR_CODE_MS, PAIR_WRONG_CODES } from "../config.mjs";

// Who may use the app. Being on localhost or the tailnet is not enough: an agent in the container reaches the app the same
// way your browser does (Docker passes it on from the host). So a browser you use is paired once, with a code, and then
// sends its key as a cookie; each agent's pi gets a key of its own when it starts, for its tools. Anything else is refused.
// agent/devices.json { devices: [{ id, name, hash, added, seen }] }: a key is kept only as its hash. Codes live in memory.

const COOKIE = "weilo_device";
const hash = (text) => createHash("sha256").update(text).digest("hex");

// --- Pairing codes ---
// Eight characters that cannot be mistaken for each other, shown as ABCD-EFGH: 40 bits, tried at most PAIR_WRONG_CODES
// times in PAIR_CODE_MS.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const plain = (code) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
const codes = new Map(); // plain code -> expiry time
let wrong = [];

export function newCode() {
  const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  codes.set(code, Date.now() + PAIR_CODE_MS);
  return { code: `${code.slice(0, 4)}-${code.slice(4)}`, expires: new Date(Date.now() + PAIR_CODE_MS).toISOString() };
}

// "Chrome on Windows", from the browser's own description.
function nameOf(agent = "") {
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "A browser";
  const system = /iPhone/.test(agent) ? "iPhone" : /iPad/.test(agent) ? "iPad" : /Android/.test(agent) ? "Android" : /Windows/.test(agent) ? "Windows" : /Mac OS X/.test(agent) ? "Mac" : /Linux/.test(agent) ? "Linux" : "";
  return system ? `${browser} on ${system}` : browser;
}

// --- Devices ---
let devices = null; // the file's list, read once
const loaded = async () => (devices ??= (await readJson(DEVICES)).devices ?? []);
const save = (change) => updateJson(DEVICES, (data) => ({ ...data, devices: change(data.devices ?? []) })).then((data) => (devices = data.devices));

// A code from a paired device (or pair.mjs) pairs this browser: its key, for the cookie.
export async function pair(code, userAgent) {
  const now = Date.now();
  wrong = wrong.filter((t) => now - t < PAIR_CODE_MS);
  if (wrong.length >= PAIR_WRONG_CODES) throw fail(429, "Too many wrong codes. Wait 10 minutes, then try again.");
  for (const [c, expires] of codes) if (expires < now) codes.delete(c);
  const key = plain(typeof code === "string" ? code : "");
  if (!codes.has(key)) {
    wrong.push(now);
    throw fail(400, "This code is not right, or it has expired. Make a new one.");
  }
  codes.delete(key);
  const token = randomBytes(32).toString("base64url");
  const at = new Date().toISOString();
  await save((list) => [...list, { id: randomBytes(6).toString("hex"), name: nameOf(userAgent), hash: hash(token), added: at, seen: at }]);
  return token;
}

export const cookieFor = (token, host = "") =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DEVICE_COOKIE_S}${/\.ts\.net(:\d+)?$/i.test(host) ? "; Secure" : ""}`;

const cookieOf = (header = "") => header.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);

export async function pairedDevices(current) {
  return (await loaded()).map(({ id, name, added, seen }) => ({ id, name, added, seen, current: id === current }));
}

export async function unpair(id) {
  if (!(await loaded()).some((d) => d.id === id)) throw fail(404, "This device is not paired");
  await save((list) => list.filter((d) => d.id !== id));
}

// --- Agents ---
// A key for each running pi, made when it starts and dropped when it stops: it never leaves the daemon and that pi.
const agentKeys = new Map(); // key -> agent id

export function agentKey(id) {
  for (const [key, owner] of agentKeys) if (owner === id) agentKeys.delete(key);
  const key = randomBytes(32).toString("base64url");
  agentKeys.set(key, id);
  return key;
}

export const dropAgentKey = (key) => agentKeys.delete(key);

// Who sent a request: { device } for a paired browser, { agent } for an agent's pi, or null.
export async function identify({ headers }) {
  const bearer = /^Bearer (\S+)$/.exec(headers.authorization ?? "")?.[1];
  if (bearer) return agentKeys.has(bearer) ? { agent: agentKeys.get(bearer) } : null;
  const token = cookieOf(headers.cookie);
  if (!token) return null;
  const device = (await loaded()).find((d) => d.hash === hash(token));
  if (!device) return null;
  if (Date.now() - Date.parse(device.seen) > DEVICE_SEEN_MS) void save((list) => list.map((d) => (d.id === device.id ? { ...d, seen: new Date().toISOString() } : d))).catch(() => {});
  return { device: device.id };
}
