import { createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, randomUUID, sign } from "node:crypto";
import { watchingAgents } from "./agents/status.mjs";
import { fail, plainText, PUSH, readJson, updateJson } from "./common.mjs";
import { PUSH_BODY_CHARS, PUSH_SEEN_MS, PUSH_SUBJECT, PUSH_TIMEOUT_MS, PUSH_TTL_S } from "./config.mjs";

const b64url = (buffer) => Buffer.from(buffer).toString("base64url");

const PUSH_SERVICE = /^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//;

async function vapid() {
  const { vapid: saved } = await readJson(PUSH);
  if (saved) return saved;
  return (
    await updateJson(PUSH, (data) => {
      if (data.vapid) return data;
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const jwk = privateKey.export({ format: "jwk" });
      const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
      return { ...data, vapid: { publicKey: b64url(raw), privateKey: jwk } };
    })
  ).vapid;
}

const linked = (devices = []) => devices.filter((d) => d.paired);

export async function pushStatus() {
  const { publicKey } = await vapid();
  const { devices, muted = [] } = await readJson(PUSH);
  return { publicKey, devices: linked(devices).map((d) => d.id), muted };
}

export async function addDevice({ subscription }, paired) {
  const { endpoint, keys } = subscription ?? {};
  if (typeof endpoint !== "string" || !PUSH_SERVICE.test(endpoint) || typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string") throw fail(400, "This browser's notification address is not valid");
  const { devices } = await updateJson(PUSH, (data) => {
    const was = (data.devices ?? []).find((d) => d.endpoint === endpoint);
    const device = { id: was?.id ?? randomUUID(), endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, paired };
    return { ...data, devices: [...(data.devices ?? []).filter((d) => d.endpoint !== endpoint), device] };
  });
  return { id: devices.find((d) => d.endpoint === endpoint).id };
}

export const notifiedDevices = async () => new Set(linked((await readJson(PUSH)).devices).map((d) => d.paired));

export const removeDevice = (id) => updateJson(PUSH, (data) => ({ ...data, devices: (data.devices ?? []).filter((d) => d.id !== id) }));
export const removePaired = (paired) => updateJson(PUSH, (data) => ({ ...data, devices: (data.devices ?? []).filter((d) => d.paired !== paired) }));

export async function setMuted(muted) {
  if (!Array.isArray(muted) || !muted.every((id) => typeof id === "string")) throw fail(400, "The list is not valid");
  await updateJson(PUSH, (data) => ({ ...data, muted }));
}

let seen = 0;
export const markSeen = () => (seen = Date.now());

function encrypt(text, { p256dh, auth }) {
  const browserKey = Buffer.from(p256dh, "base64url");
  const ecdh = createECDH("prime256v1");
  const ownKey = ecdh.generateKeys();
  const secret = ecdh.computeSecret(browserKey);
  const ikm = hkdfSync("sha256", secret, Buffer.from(auth, "base64url"), Buffer.concat([Buffer.from("WebPush: info\0"), browserKey, ownKey]), 32);
  const salt = randomBytes(16);
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(ikm), salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", Buffer.from(ikm), salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(text), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(ownKey.length, 20);
  return Buffer.concat([header, ownKey, body]);
}

function signature(endpoint, { publicKey, privateKey }) {
  const head = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64url(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: PUSH_SUBJECT }));
  const signed = sign("sha256", Buffer.from(`${head}.${claims}`), { key: createPrivateKey({ key: privateKey, format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${claims}.${b64url(signed)}, k=${publicKey}`;
}

async function send(device, payload, keys) {
  try {
    const res = await fetch(device.endpoint, {
      method: "POST",
      headers: { Authorization: signature(device.endpoint, keys), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: String(PUSH_TTL_S), Urgency: "high" },
      body: encrypt(payload, device.keys),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 410) await removeDevice(device.id);
    else if (!res.ok) console.error(`Notification not sent (${res.status} from ${new URL(device.endpoint).host})`);
  } catch (err) {
    console.error(`Notification not sent: ${err.message}`);
  }
}

export async function notify(agent, kind, text) {
  if (watchingAgents() || Date.now() - seen < PUSH_SEEN_MS) return;
  const { devices: all, muted = [] } = await readJson(PUSH).catch(() => ({}));
  const devices = linked(all);
  if (!devices.length || muted.includes(agent.id)) return;
  const said = plainText(text ?? "");
  const body = kind === "ask" ? `Asks you: ${said}` : kind === "remind" ? `Still waiting for you: ${said}` : kind === "error" ? `Stopped with a problem${said ? `: ${said}` : "."}` : said || "Replied.";
  const payload = JSON.stringify({ title: agent.name, body: body.length > PUSH_BODY_CHARS ? `${body.slice(0, PUSH_BODY_CHARS - 1)}…` : body, agent: agent.id, kind });
  const keys = await vapid();
  await Promise.all(devices.map((device) => send(device, payload, keys)));
}
