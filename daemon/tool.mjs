import { request } from "node:http";

export const object = (properties, required) => ({ type: "object", properties, required });
export const str = { type: "string" };
export const note = (description) => ({ type: "string", description });

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
