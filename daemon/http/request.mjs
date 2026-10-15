import { fail } from "../common.mjs";
import { MAX_BODY } from "../config.mjs";

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
  const link = headers["sec-fetch-mode"] === "navigate" && !path.startsWith("/api/");
  if (site && site !== "same-origin" && site !== "none" && !link) throw fail(403, "Not permitted");
}

export async function bodyOf(req) {
  let text = "";
  req.setEncoding("utf8");
  for await (const chunk of req) {
    text += chunk;
    if (text.length > MAX_BODY) throw fail(413, "The request is too large");
  }
  try {
    const body = text ? JSON.parse(text) : {};
    return body && typeof body === "object" ? body : {};
  } catch {
    throw fail(400, "The request is not valid JSON");
  }
}

export const reply = (res, status, body) => {
  res.writeHead(status, body === undefined ? {} : { "Content-Type": "application/json" });
  res.end(body === undefined ? undefined : JSON.stringify(body));
};
