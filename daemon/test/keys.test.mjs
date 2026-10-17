import "./root.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { KEYS, readJson, updateJson } from "../common.mjs";
import { forgetKeys, keyTool, listKeys, redact, removeKey } from "../agents/keys.mjs";

const save = (agent, name, key) => updateJson(KEYS, (data) => ({ ...data, [agent]: { ...data[agent], [name]: key } }));

test("a key is taken out of an answer, as it is and encoded", () => {
  const auth = { type: "basic", username: "me" };
  const value = "s3cret+value/1";
  const text = `a ${value} b ${encodeURIComponent(value)} c ${Buffer.from(value).toString("base64")} d ${Buffer.from(`me:${value}`).toString("base64")}`;
  assert.equal(redact(text, auth, value), "a [key] b [key] c [key] d [key]");
});

test("an agent sees its keys' names and sites, never their values", async () => {
  await save("k1", "weather", { origin: "https://api.weather.test", auth: { type: "bearer" }, value: "abc123", saved: "2026-01-01" });
  assert.deepEqual(await listKeys("k1"), [{ name: "weather", origin: "https://api.weather.test", saved: "2026-01-01" }]);
  const { text } = await keyTool("k1", { action: "list" });
  assert.match(text, /weather: https:\/\/api\.weather\.test \(bearer\)/);
  assert.doesNotMatch(text, /abc123/);
  assert.deepEqual(await listKeys("other"), []);
});

test("a key goes only to its own site, over https", async () => {
  await save("k2", "shop", { origin: "https://shop.test", auth: { type: "header", header: "X-Api-Key" }, value: "v", saved: "x" });
  await assert.rejects(keyTool("k2", { action: "use", name: "shop", url: "https://evil.test/steal" }), /only for https:\/\/shop\.test/);
  await assert.rejects(keyTool("k2", { action: "use", name: "shop", url: "http://shop.test/" }), /only for/);
  await assert.rejects(keyTool("k2", { action: "use", name: "nope", url: "https://shop.test/" }), /no key "nope"/);
  await assert.rejects(keyTool("k2", { action: "use", name: "shop", url: "https://shop.test/", method: "TRACE" }), /method/);
  await assert.rejects(keyTool("k2", { action: "ask", name: "x", site: "http://plain.test" }), /https/);
  await assert.rejects(keyTool("k2", { action: "ask", name: "x", site: "https://a.test", auth: "header" }), /header/);
  await assert.rejects(keyTool("k2", { action: "ask", name: "shop", site: "https://other.test" }), /other settings/);
  assert.match((await keyTool("k2", { action: "ask", name: "shop", site: "https://shop.test", auth: "header", header: "X-Api-Key" })).text, /saved already/);
});

test("keys are forgotten one by one, or all with their agent", async () => {
  await save("k3", "a", { origin: "https://a.test", auth: { type: "bearer" }, value: "1", saved: "x" });
  await save("k3", "b", { origin: "https://b.test", auth: { type: "bearer" }, value: "2", saved: "x" });
  await removeKey("k3", "a");
  assert.deepEqual((await listKeys("k3")).map((k) => k.name), ["b"]);
  await assert.rejects(removeKey("k3", "a"), /does not exist/);
  await forgetKeys("k3");
  assert.equal((await readJson(KEYS)).k3, undefined);
});
