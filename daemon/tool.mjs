import { request } from "node:http";

// What the bundled extensions (browser/ and routines/ `extension/`, memory/extension.mjs) share. They run inside pi, not the daemon: each
// tool only calls the daemon's HTTP API, with the key the daemon gave this pi (WEILO_KEY), and the daemon checks every call. Its answer, or why it refused, goes back to the agent as text.

export const object = (properties, required) => ({ type: "object", properties, required });
export const str = { type: "string" };
export const note = (description) => ({ type: "string", description });

// node:http, not fetch: fetch gives up on an answer after five minutes, and a call may wait on the user (manage_agents).
export const call = (method, path, body, signal) =>
  new Promise((resolve, reject) => {
    const headers = { "content-type": "application/json", authorization: `Bearer ${process.env.WEILO_KEY}` };
    const req = request(process.env.WEILO_API + path, { method, headers, signal }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (text += chunk));
      res.on("error", reject);
      res.on("end", () => {
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(data?.error ?? `The request failed (${res.statusCode})`));
      });
    });
    req.on("error", reject);
    req.end(body && JSON.stringify(body));
  });

// A tool that posts its arguments to /agents/<this agent>/<name> and returns the `text` of the answer, and its `details`
// for the chat (a line it shows, such as a change the agent made).
export const daemonTool = (pi, name, label, description, parameters, required) =>
  pi.registerTool({
    name,
    label,
    description,
    parameters: object(parameters, required),
    async execute(_id, args, signal) {
      const { text, details } = await call("POST", `/agents/${process.env.WEILO_AGENT}/${name}`, args, signal).catch((err) => ({ text: `Could not do that: ${err.message}` }));
      return { content: [{ type: "text", text }], details };
    },
  });
