import { root } from "./root.mjs";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { removeAction, runAction } from "../actions/actions.mjs";
import { listPins, numberIn, pinTool, removePin, tickPin } from "../actions/pins.mjs";
import { ACTIONS } from "../common.mjs";
import { profilePath } from "../agents/agents.mjs";

const uid = process.getuid?.() ?? 1000;
const agent = { id: "pin", name: "P", uid, folder: "pin", isolated: false, disabled: [] };
mkdirSync(join(root, "workspace", "pin"), { recursive: true });
mkdirSync(dirname(profilePath("pin")), { recursive: true });
writeFileSync(profilePath("pin"), JSON.stringify(agent));
// A script that reads a price, saved as an action the user approved earlier.
const script = "export default async ({ input }) => ({ pin: { value: `$${input.price}`, detail: 'at Best Buy' } });";
writeFileSync(ACTIONS, JSON.stringify({ timezone: "UTC", items: [{ id: "price", agentId: "pin", title: "Check price", about: "", kind: "script", request: "", script, fields: [{ name: "price", label: "Price", default: "199" }], icon: "tag", schedule: null, runs: [] }] }));

test("the number in a value, for the chart", () => {
  assert.equal(numberIn("$1,299.99"), 1299.99);
  assert.equal(numberIn("Out for delivery"), null);
});

test("an agent pins a list; the user ticks it and removes it", async () => {
  const { text, details } = await pinTool("pin", { op: "pin", title: "Groceries", items: ["Milk", { text: "Eggs" }] });
  assert.match(text, /Pinned/);
  assert.deepEqual(details, { op: "pin", title: "Groceries" });
  const [list] = await listPins("pin");
  assert.equal(list.kind, "list");
  assert.equal((await tickPin("pin", list.id, { index: 1, done: true })).items[1].done, true);
  await assert.rejects(tickPin("pin", list.id, { index: 5, done: true }), /not on the list/);
  assert.match((await pinTool("pin", { op: "list" })).text, /1\. \[x\] Eggs/);
  await removePin("pin", list.id);
  assert.deepEqual(await listPins("pin"), []);
});

test("a pin is checked", async () => {
  await assert.rejects(pinTool("pin", { op: "pin", title: "" }), /title/);
  await assert.rejects(pinTool("pin", { op: "pin", title: "T", steps: { done: 5, total: 4 } }), /steps/);
  await assert.rejects(pinTool("pin", { op: "pin", title: "T", action: "nope" }), /No action has that id/);
});

test("a script action keeps its pin fresh, and is quiet when nothing changed", async () => {
  await pinTool("pin", { op: "pin", title: "AirPods Pro", value: "$219", action: "price", icon: "tag" });
  const first = await runAction("pin", "price", {}, "schedule");
  assert.deepEqual([first.text, first.quiet], ["AirPods Pro: $199, at Best Buy", false]);
  let [pin] = await listPins("pin");
  assert.deepEqual([pin.value, pin.history], ["$199", [219, 199]]);
  const same = await runAction("pin", "price", {}, "schedule");
  assert.deepEqual([same.text, same.quiet], ["No change.", true]);
  assert.equal((await runAction("pin", "price", { price: "189" })).quiet, false);
  await removeAction("pin", "price");
  [pin] = await listPins("pin");
  assert.deepEqual([pin.value, pin.actionId], ["$189", null]);
});
