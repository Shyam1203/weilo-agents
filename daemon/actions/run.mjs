import { call } from "../tool.mjs";

const out = (answer) => process.stdout.write(`\n${JSON.stringify(answer)}\n`);

try {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const { script, input } = JSON.parse(raw);
  const browser = async (args) => (await call("POST", `/agents/${process.env.WEILO_AGENT}/browser`, args)).text;
  const module = await import(`data:text/javascript;base64,${Buffer.from(script).toString("base64")}`);
  if (typeof module.default !== "function") throw new Error("The script must export a default async function.");
  out({ ok: true, result: await module.default({ input, browser }) });
} catch (err) {
  out({ ok: false, error: String(err?.message ?? err) });
}
process.exit(0);
