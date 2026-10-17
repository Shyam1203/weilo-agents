import { createHash, randomBytes } from "node:crypto";
import { fail, MCP, readJson, updateJson } from "../common.mjs";
import { OAUTH_FRESH_MS, OAUTH_PENDING_MS, OAUTH_TIMEOUT_MS } from "../config.mjs";

// Signing in to a plugin on the web (an MCP server) with OAuth, as MCP asks: the server names its
// authorization server (RFC 9728), whose metadata (RFC 8414) gives the addresses; the app registers
// itself there (RFC 7591) and signs in with PKCE. The tokens stay in mcp.json, which only the app
// reads; agents reach the plugin through the app's proxy, which adds the token (proxyPlugin).

export const CALLBACK = "/api/plugins/oauth/callback";

// Sign-ins started and not finished yet, by their state.
const pending = new Map();
const refreshing = new Map();

const b64url = (buffer) => Buffer.from(buffer).toString("base64url");

const request = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS), headers: { accept: "application/json", ...init.headers } });

async function json(url, init) {
  const res = await request(url, init).catch(() => null);
  if (!res?.ok) return null;
  return res.json().catch(() => null);
}

const INITIALIZE = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Weilo Agents", version: "1" } } });

/** What the plugin answers to a first request: its status and the WWW-Authenticate challenge. */
async function knock(url, token) {
  const res = await request(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token && { authorization: `Bearer ${token}` }) }, body: INITIALIZE }).catch(() => null);
  await res?.body?.cancel().catch(() => {});
  return { status: res?.status ?? 0, challenge: res?.headers.get("www-authenticate") ?? "" };
}

/** Whether the plugin turns the app away until someone signs in. */
export const asksSignIn = async (url, token) => (await knock(url, token)).status === 401;

async function resourceOf(url) {
  const { challenge } = await knock(url);
  const named = /resource_metadata="([^"]+)"/i.exec(challenge)?.[1];
  const { origin, pathname } = new URL(url);
  const path = pathname.replace(/\/$/, "");
  for (const at of [named, path && `${origin}/.well-known/oauth-protected-resource${path}`, `${origin}/.well-known/oauth-protected-resource`].filter(Boolean)) {
    const meta = await json(at);
    if (meta) return meta;
  }
  return null;
}

async function serverOf(issuer) {
  const { origin, pathname } = new URL(issuer);
  const path = pathname.replace(/\/$/, "");
  const tries = path
    ? [`${origin}/.well-known/oauth-authorization-server${path}`, `${origin}/.well-known/openid-configuration${path}`, `${origin}${path}/.well-known/openid-configuration`]
    : [`${origin}/.well-known/oauth-authorization-server`, `${origin}/.well-known/openid-configuration`];
  for (const at of tries) {
    const meta = await json(at);
    if (meta?.authorization_endpoint && meta.token_endpoint) return meta;
  }
  return null;
}

async function register(meta, redirect) {
  if (!meta.registration_endpoint) throw fail(409, "This plugin's sign-in works only with apps registered with it beforehand. Add it with an access token instead.");
  const client = await json(meta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Weilo Agents", redirect_uris: [redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
  });
  if (!client?.client_id) throw fail(502, "The plugin's sign-in did not accept Weilo Agents. Try again later, or add it with an access token.");
  return { id: client.client_id, ...(client.client_secret && { secret: client.client_secret }) };
}

const pluginOf = async (name) => {
  const plugin = (await readJson(MCP)).mcpServers?.[name];
  if (!plugin) throw fail(404, "This plugin does not exist");
  if (!plugin.url) throw fail(400, "Only a plugin on the web can be signed in to");
  return plugin;
};

const saveOAuth = (name, oauth) =>
  updateJson(MCP, (data) => {
    const plugin = data.mcpServers?.[name];
    if (!plugin) throw fail(404, "This plugin was deleted meanwhile");
    const next = { ...plugin };
    if (oauth) next.oauth = oauth;
    else delete next.oauth;
    return { ...data, mcpServers: { ...data.mcpServers, [name]: next } };
  });

/** Start signing in: the address of the plugin's sign-in page, which sends the browser back to origin. */
export async function startSignIn(name, origin) {
  const plugin = await pluginOf(name);
  const resource = await resourceOf(plugin.url);
  const issuer = resource?.authorization_servers?.[0] ?? new URL(plugin.url).origin;
  const meta = await serverOf(issuer);
  if (!meta) throw fail(409, "This plugin does not offer a sign-in. Add it with an access token instead.");
  const redirect = `${origin}${CALLBACK}`;
  const saved = plugin.oauth?.client;
  const client = saved && saved.redirect === redirect && saved.issuer === issuer ? saved : { ...(await register(meta, redirect)), redirect, issuer };
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(24));
  for (const [key, p] of pending) if (p.until < Date.now()) pending.delete(key);
  const target = resource?.resource ?? plugin.url;
  pending.set(state, { name, verifier, client, tokenUrl: meta.token_endpoint, resource: target, until: Date.now() + OAUTH_PENDING_MS });
  const url = new URL(meta.authorization_endpoint);
  const scope = resource?.scopes_supported?.join(" ");
  const params = { response_type: "code", client_id: client.id, redirect_uri: redirect, code_challenge: b64url(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256", state, resource: target, ...(scope && { scope }) };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return { url: url.href };
}

async function tokens(tokenUrl, client, params) {
  const body = new URLSearchParams({ ...params, client_id: client.id, ...(client.secret && { client_secret: client.secret }) });
  const res = await request(tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }).catch((err) => {
    throw fail(502, `The sign-in did not go through: ${err.message}`);
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.access_token !== "string") throw fail(502, `The sign-in did not go through: ${data.error_description ?? data.error ?? `status ${res.status}`}`);
  return { access: data.access_token, ...(data.refresh_token && { refresh: data.refresh_token }), expires: Number(data.expires_in) > 0 ? Date.now() + Number(data.expires_in) * 1000 : null };
}

/** The browser came back from the plugin's sign-in page: get the tokens and keep them. Returns the plugin's name. */
export async function finishSignIn(state, code, error) {
  const p = pending.get(state);
  pending.delete(state);
  if (!p || p.until < Date.now()) throw fail(400, "This sign-in has expired. Start it again in Settings > Plugins.");
  if (error || !code) throw fail(400, `The sign-in was not finished${error ? ` (${error})` : ""}.`);
  const got = await tokens(p.tokenUrl, p.client, { grant_type: "authorization_code", code, redirect_uri: p.client.redirect, code_verifier: p.verifier, resource: p.resource });
  await saveOAuth(p.name, { client: p.client, tokenUrl: p.tokenUrl, resource: p.resource, ...got });
  return p.name;
}

export const signOut = async (name) => (await pluginOf(name), saveOAuth(name, null));

/** A plugin's access token, renewed when it is about to run out; null when nobody signed in. */
export async function accessToken(name, plugin) {
  const oauth = plugin.oauth;
  if (!oauth?.access) return null;
  if (!oauth.expires || oauth.expires - Date.now() > OAUTH_FRESH_MS || !oauth.refresh) return oauth.access;
  if (!refreshing.has(name)) {
    const renew = tokens(oauth.tokenUrl, oauth.client, { grant_type: "refresh_token", refresh_token: oauth.refresh, resource: oauth.resource })
      .then(async (got) => {
        await saveOAuth(name, { ...oauth, ...got, refresh: got.refresh ?? oauth.refresh });
        return got.access;
      })
      .finally(() => refreshing.delete(name));
    refreshing.set(name, renew);
  }
  return refreshing.get(name).catch(() => oauth.access);
}
