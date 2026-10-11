import { fail } from "../common.mjs";
import { MAX_BODY } from "../config.mjs";

// Only this machine's own pages may use the API: this blocks other websites and DNS rebinding. The machine is reached as
// localhost, or by its Tailscale name (`tailscale serve` forwards it here, over https): only a tailnet's own devices resolve a
// `.ts.net` name, and a hostile site cannot point one at this machine.
// Another site (or an agent's page) may link to the app, but not load anything from it.
const ALLOWED_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|([a-z0-9-]+\.)+ts\.net)(:\d+)?$/i;

// Whether the Origin header names the same host the request was sent to (over http or https).
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

// The request's JSON body; none is {}.
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

// A JSON reply, or an empty one when there is no body.
export const reply = (res, status, body) => {
  res.writeHead(status, body === undefined ? {} : { "Content-Type": "application/json" });
  res.end(body === undefined ? undefined : JSON.stringify(body));
};
