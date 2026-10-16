import "./root.mjs";
import assert from "node:assert/strict";
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from "node:crypto";
import { test } from "node:test";
import { addDevice, encrypt, notifiedDevices, pushStatus, removePaired } from "../push.mjs";

function decrypt(body, ecdh, auth) {
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const serverKey = body.subarray(21, 21 + idLength);
  const data = body.subarray(21 + idLength);
  const ikm = Buffer.from(hkdfSync("sha256", ecdh.computeSecret(serverKey), auth, Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), serverKey]), 32));
  const key = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(data.subarray(-16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
  assert.equal(plain.at(-1), 2);
  return plain.subarray(0, -1).toString();
}

test("a notification can be read only with the browser's keys", () => {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const keys = { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") };
  const body = encrypt('{"title":"Agent","body":"Done."}', keys);
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(decrypt(body, ecdh, auth), '{"title":"Agent","body":"Done."}');
  assert.throws(() => decrypt(body, ecdh, randomBytes(16)));
});
const sub = (n) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: "p", auth: "a" } });

test("notifications belong to the paired device that turned them on", async () => {
  const { id: old } = await addDevice({ subscription: sub(3) });
  const { id } = await addDevice({ subscription: sub(1) }, "dev1");
  const again = await addDevice({ subscription: sub(1) }, "dev1");
  const { id: other } = await addDevice({ subscription: sub(2) }, "dev2");
  assert.equal(again.id, id);
  assert.deepEqual([...(await notifiedDevices())], ["dev1", "dev2"]);
  await removePaired("dev1");
  assert.deepEqual((await pushStatus()).devices, [other]);
  assert.ok(!(await pushStatus()).devices.includes(old));
});
