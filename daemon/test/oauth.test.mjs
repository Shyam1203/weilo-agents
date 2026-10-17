import "./root.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { MCP, readJson, updateJson } from "../common.mjs";
import { accessToken, asksSignIn, finishSignIn, signOut, startSignIn } from "../settings/oauth.mjs";

// A plugin on the web that asks for a sign-in, with its own authorization server, as MCP describes.
const seen = { registered: [], tokens: [] };
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (status, data, headers = {}) => (res.writeHead(status, { "content-type": "application/json", ...headers }), res.end(JSON.stringify(data)));
  if (req.url === "/mcp") return req.headers.authorization === "Bearer token-2" ? send(200, {}) : send(401, { error: "sign in" }, { "www-authenticate": `Bearer resource_metadata="${base}/meta"` });
  if (req.url === "/meta") return send(200, { resource: `${base}/mcp`, authorization_servers: [`${base}/auth`], scopes_supported: ["read", "write"] });
  if (req.url === "/.well-known/oauth-authorization-server/auth") return send(200, { authorization_endpoint: `${base}/auth/authorize`, token_endpoint: `${base}/auth/token`, registration_endpoint: `${base}/auth/register` });
  if (req.url === "/auth/register") return seen.registered.push(JSON.parse(body)), send(201, { client_id: "client-1" });
  if (req.url === "/auth/token") {
    const form = Object.fromEntries(new URLSearchParams(body));
    seen.tokens.push(form);
    return form.grant_type === "refresh_token" ? send(200, { access_token: "token-2", expires_in: 3600 }) : send(200, { access_token: "token-1", refresh_token: "refresh-1", expires_in: 1 });
  }
  send(404, {});
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test.after(() => server.close());

test("signing in to a plugin finds its sign-in, registers, and keeps the tokens", async () => {
  await updateJson(MCP, () => ({ mcpServers: { notes: { url: `${base}/mcp` }, local: { command: "x" } } }));
  assert.equal(await asksSignIn(`${base}/mcp`), true);
  await assert.rejects(startSignIn("local", "http://localhost:3210"), /on the web/);

  const { url } = await startSignIn("notes", "http://localhost:3210");
  const page = new URL(url);
  assert.equal(page.origin + page.pathname, `${base}/auth/authorize`);
  assert.equal(page.searchParams.get("client_id"), "client-1");
  assert.equal(page.searchParams.get("redirect_uri"), "http://localhost:3210/api/plugins/oauth/callback");
  assert.equal(page.searchParams.get("code_challenge_method"), "S256");
  assert.equal(page.searchParams.get("resource"), `${base}/mcp`);
  assert.equal(page.searchParams.get("scope"), "read write");
  assert.deepEqual(seen.registered[0].redirect_uris, ["http://localhost:3210/api/plugins/oauth/callback"]);

  await assert.rejects(finishSignIn("not-a-state", "code"), /expired/);
  assert.equal(await finishSignIn(page.searchParams.get("state"), "code-1"), "notes");
  const exchange = seen.tokens[0];
  assert.equal(exchange.code, "code-1");
  assert.equal(createHash("sha256").update(exchange.code_verifier).digest("base64url"), page.searchParams.get("code_challenge"));
  // A state is good once.
  await assert.rejects(finishSignIn(page.searchParams.get("state"), "code-1"), /expired/);

  const saved = (await readJson(MCP)).mcpServers.notes;
  assert.equal(saved.oauth.access, "token-1");
  // It ran out (expires_in 1): it is renewed with the refresh token, and the new one is kept.
  assert.equal(await accessToken("notes", saved), "token-2");
  assert.equal(seen.tokens[1].refresh_token, "refresh-1");
  const renewed = (await readJson(MCP)).mcpServers.notes;
  assert.equal(renewed.oauth.access, "token-2");
  assert.equal(renewed.oauth.refresh, "refresh-1");
  assert.equal(await asksSignIn(`${base}/mcp`, "token-2"), false);

  // A second sign-in from the same address keeps the registered app.
  await startSignIn("notes", "http://localhost:3210");
  assert.equal(seen.registered.length, 1);

  await signOut("notes");
  assert.equal((await readJson(MCP)).mcpServers.notes.oauth, undefined);
  assert.equal(await accessToken("notes", (await readJson(MCP)).mcpServers.notes), null);
});
