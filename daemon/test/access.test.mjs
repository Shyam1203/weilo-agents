import "./root.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentKey, dropAgentKey, identify, keyIn } from "../http/access.mjs";
import { guard } from "../http/request.mjs";
import { keyedHeaders, placeholderFor, swapKey } from "../gateway/models.mjs";

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

test("an agent's key is found inside the placeholder token its pi sends", () => {
  const key = agentKey("a2");
  const placeholder = placeholderFor("anthropic", key, "sk-ant-oat01-real");
  assert.deepEqual(keyIn({ headers: { authorization: `Bearer ${placeholder}` } }, new URLSearchParams()), { key, agent: "a2" });
  dropAgentKey(key);
});

test("each provider's placeholder is shaped like its token and swapped for the real one whole", () => {
  const key = "k".repeat(43);
  const jwt = `e30.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" } })).toString("base64url")}.sig`;
  const cases = [["anthropic", "sk-ant-oat01-real"], ["openai", jwt], ["github-copilot", "tid=1;exp=9;proxy-ep=proxy.individual.githubcopilot.com;sku=x"], ["openrouter", "sk-or-real"]];
  for (const [provider, real] of cases) {
    const placeholder = placeholderFor(provider, key, real);
    assert.ok(placeholder.includes(key) && !placeholder.includes(real), provider);
    assert.equal(swapKey(`Bearer ${placeholder}`, key, real), `Bearer ${real}`, provider);
  }
  assert.match(placeholderFor("anthropic", key, ""), /^sk-ant-oat/);
  const claims = JSON.parse(Buffer.from(placeholderFor("openai", key, jwt).split(".")[1], "base64url").toString());
  assert.equal(claims["https://api.openai.com/auth"].chatgpt_account_id, "acct_1");
  assert.match(placeholderFor("github-copilot", key, cases[2][1]), /proxy-ep=proxy\.individual\.githubcopilot\.com/);
});

test("the real token goes only into the auth headers; any other header holding the key is dropped", () => {
  const key = "k".repeat(43);
  const real = "sk-ant-oat01-$&real";
  const headers = keyedHeaders({ "x-api-key": `sk-ant-oat01-${key}`, "anthropic-beta": key, "content-type": "application/json" }, key, real);
  assert.deepEqual(headers, { "x-api-key": real, "content-type": "application/json" });
});
