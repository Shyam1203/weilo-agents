import { root } from "./root.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { actionTool, filled, planAction, runScript, shown, valuesOf } from "../actions/actions.mjs";
import { profilePath } from "../agents/agents.mjs";
import { dropScriptKey, identify, keyIn, scriptKey } from "../http/access.mjs";

const uid = process.getuid?.() ?? 1000;
const agent = { id: "act", name: "A", uid, folder: "act", isolated: false, disabled: [] };
mkdirSync(join(root, "workspace", "act"), { recursive: true });

test("an agent action fills its blanks from its fields", () => {
  const plan = planAction({ title: "Track", kind: "agent", request: "Track {number} with {carrier}", fields: [{ name: "number" }, { name: "carrier", options: ["UPS", "DHL"], default: "UPS" }] });
  assert.equal(plan.fields[0].label, "number");
  const values = valuesOf(plan, { number: " 1Z99 " });
  assert.deepEqual(values, { number: "1Z99", carrier: "UPS" });
  assert.equal(filled(plan.request, values), "Track 1Z99 with UPS");
  assert.throws(() => valuesOf(plan, {}), /Fill in number/);
  assert.throws(() => valuesOf(plan, { number: "1", carrier: "FedEx" }), /Choose one of the options/);
});

test("an action is checked before it is saved", () => {
  assert.throws(() => planAction({ kind: "agent", request: "x" }), /title/);
  assert.throws(() => planAction({ title: "T", kind: "agent", request: "Order {dish}" }), /no field has that name/);
  assert.throws(() => planAction({ title: "T", kind: "script", script: "return 1" }), /export a default/);
  assert.throws(() => planAction({ title: "T", kind: "script", script: "export default async () => 1" }, {}, true), /isolated agent/);
  assert.throws(() => planAction({ title: "T", kind: "agent", request: "x", fields: [{ name: "A b" }] }), /lowercase/);
  const changed = planAction({ confirm: true }, planAction({ title: "T", kind: "agent", request: "Hi", icon: "nope" }));
  assert.equal(changed.confirm, true);
  assert.equal(changed.icon, "bolt");
  assert.equal(changed.request, "Hi");
});

test("a script's answer is shown as text", () => {
  assert.equal(shown("Out for delivery"), "Out for delivery");
  assert.equal(shown({ status: "Out", eta: 7 }), "status: Out\neta: 7");
  assert.equal(shown(undefined), "Done.");
  assert.ok(shown("x".repeat(5000)).length < 2100);
});

test("a script runs on its own and returns its answer", async () => {
  const ok = await runScript(agent, 'import { platform } from "node:os"; export default async ({ input }) => ({ hello: input.name, os: typeof platform() });', { name: "Sam" });
  assert.equal(ok.ok, true, ok.text);
  assert.equal(ok.text, "hello: Sam\nos: string");
  const bad = await runScript(agent, 'export default async () => { throw new Error("the site changed"); }', {});
  assert.deepEqual([bad.ok, bad.text], [false, "Failed: the site changed"]);
  const none = await runScript(agent, "export const x = 1;", {});
  assert.match(none.text, /default async function/);
});

test("a script's key reaches nothing but its agent's browser", async () => {
  const key = scriptKey("act");
  assert.deepEqual(await identify({ headers: { authorization: `Bearer ${key}` } }), { agent: "act", script: true });
  assert.equal(keyIn({ headers: { authorization: `Bearer ${key}` } }, new URLSearchParams()), null);
  dropScriptKey(key);
  assert.equal(await identify({ headers: { authorization: `Bearer ${key}` } }), null);
});

test("a script uses its agent's browser through the app, with its own key", async () => {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      seen.push({ path: req.url, who: await identify(req), body: JSON.parse(body) });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ text: "Order #4821 — Out for delivery" }));
    });
  });
  await new Promise((resolve) => server.listen(3210, "127.0.0.1", resolve));
  try {
    const result = await runScript(agent, 'export default async ({ browser }) => (await browser({ action: "open", url: "https://shop.example/orders" })).split(" — ")[1];', {});
    assert.equal(result.text, "Out for delivery");
    assert.equal(seen[0].path, "/api/agents/act/browser");
    assert.deepEqual(seen[0].who, { agent: "act", script: true });
    assert.deepEqual(seen[0].body, { action: "open", url: "https://shop.example/orders" });
  } finally {
    server.close();
  }
});

test("an agent tries a script before saving it, without a title", async () => {
  mkdirSync(dirname(profilePath("act")), { recursive: true });
  writeFileSync(profilePath("act"), JSON.stringify(agent));
  const { text } = await actionTool("act", { op: "try", script: "export default async ({ input }) => `Tracking ${input.number}`;", fields: [{ name: "number" }], input: { number: "1Z" } });
  assert.match(text, /^It worked \(\d+ ms\):\nTracking 1Z$/);
  assert.equal((await actionTool("act", { op: "list" })).text, "No actions yet.");
});
