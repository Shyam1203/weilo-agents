import "./root.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentKey, dropAgentKey, identify, keyIn } from "../http/access.mjs";
import { guard } from "../http/request.mjs";

const req = (headers) => ({ headers: { host: "localhost:3210", ...headers } });

test("guard lets the app's own pages and calls through", () => {
  guard(req({}), "/api/agents");
  guard(req({ origin: "http://localhost:3210", "sec-fetch-site": "same-origin" }), "/api/agents");
  guard(req({ host: "box.tail1234.ts.net" }), "/");
  guard(req({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }), "/");
});

test("guard refuses other hosts and other sites", () => {
  assert.throws(() => guard(req({ host: "evil.example" }), "/api/agents"), { status: 403 });
  assert.throws(() => guard(req({ origin: "https://evil.example" }), "/api/agents"), { status: 403 });
  assert.throws(() => guard(req({ "sec-fetch-site": "cross-site" }), "/api/agents"), { status: 403 });
  assert.throws(() => guard(req({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }), "/api/agents"), { status: 403 });
});

test("an agent's key works until it is dropped, and a new key replaces the old one", async () => {
  const first = agentKey("a1");
  const key = agentKey("a1");
  assert.equal(await identify({ headers: { authorization: `Bearer ${first}` } }), null);
  assert.deepEqual(await identify({ headers: { authorization: `Bearer ${key}` } }), { agent: "a1" });
  assert.deepEqual(keyIn({ headers: { "x-api-key": key } }, new URLSearchParams()), { key, agent: "a1" });
  assert.deepEqual(keyIn({ headers: {} }, new URLSearchParams({ key })), { key, agent: "a1" });
  dropAgentKey(key);
  assert.equal(keyIn({ headers: { authorization: `Bearer ${key}` } }, new URLSearchParams()), null);
});

test("no cookie or an unknown cookie is not a device", async () => {
  assert.equal(await identify({ headers: {} }), null);
  assert.equal(await identify({ headers: { cookie: "weilo_device=nope" } }), null);
});
