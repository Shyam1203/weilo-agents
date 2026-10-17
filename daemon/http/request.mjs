import { fail } from "../common.mjs";
import { MAX_BODY } from "../config.mjs";
import { CALLBACK } from "../settings/oauth.mjs";

const ALLOWED_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|([a-z0-9-]+\.)+ts\.net)(:\d+)?$/i;

function sameHost(origin, host) {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && url.host === host.toLowerCase();
  } catch {
    return false;
  }
}

export function guard({ headers }, path) {
  if (!ALLOWED_HOST.test(headers.host ?? "")) throw fail(403, "Not permitted");
  if (headers.origin && !sameHost(headers.origin, headers.host)) throw fail(403, "Not permitted");
  const site = headers["sec-fetch-site"];
  const link = headers["sec-fetch-mode"] === "navigate" && (!path.startsWith("/api/") || path === CALLBACK);
  if (site && site !== "same-origin" && site !== "none" && !link) throw fail(403, "Not permitted");
}

export async function rawBodyOf(req, max = MAX_BODY) {
  if (Number(req.headers["content-length"]) > max) throw fail(413, "The request is too large");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw fail(413, "The request is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

export async function bodyOf(req, max = MAX_BODY) {
  const text = (await rawBodyOf(req, max)).toString("utf8");
  try {
    const body = text ? JSON.parse(text) : {};
    return body && typeof body === "object" ? body : {};
  } catch {
    throw fail(400, "The request is not valid JSON");
  }
}

export const reply = (res, status, body) => {
  res.writeHead(status, body === undefined ? {} : { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" });
  res.end(body === undefined ? undefined : JSON.stringify(body));
};
