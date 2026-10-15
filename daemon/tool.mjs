// What the bundled extensions (browser/ and routines/ `extension/`, memory/extension.mjs) share. They run inside pi, not the daemon: each
// tool only calls the daemon's HTTP API, with the key the daemon gave this pi (WEILO_KEY), and the daemon checks every call. Its answer, or why it refused, goes back to the agent as text.

export const object = (properties, required) => ({ type: "object", properties, required });
export const str = { type: "string" };
export const note = (description) => ({ type: "string", description });

export const call = async (method, path, body, signal) => {
  const res = await fetch(process.env.WEILO_API + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${process.env.WEILO_KEY}` }, body: body && JSON.stringify(body), signal });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `The request failed (${res.status})`);
  return data;
};

// A tool that posts its arguments to /agents/<this agent>/<name> and returns the `text` of the answer.
export const daemonTool = (pi, name, label, description, parameters, required) =>
  pi.registerTool({
    name,
    label,
    description,
    parameters: object(parameters, required),
    async execute(_id, args, signal) {
      const text = await call("POST", `/agents/${process.env.WEILO_AGENT}/${name}`, args, signal).then(
        (data) => data.text,
        (err) => `Could not do that: ${err.message}`,
      );
      return { content: [{ type: "text", text }] };
    },
  });
