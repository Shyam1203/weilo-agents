import "./root.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { addStep, teachMessage, teachStep } from "../browser/browser.mjs";

test("each recorded step reads as plain words, and secrets are never in them", () => {
  assert.equal(teachStep({ act: "open", url: "https://shop.test/cart" }), "Opened https://shop.test/cart");
  assert.equal(teachStep({ act: "open", url: "about:blank" }), null);
  assert.equal(teachStep({ act: "click", kind: "link", name: "Orders" }), 'Clicked the link "Orders"');
  assert.equal(teachStep({ act: "click", kind: "button", name: "Add to cart" }), 'Clicked "Add to cart"');
  assert.equal(teachStep({ act: "click", kind: "box", name: "Gift wrap" }), 'Ticked "Gift wrap"');
  assert.equal(teachStep({ act: "click", kind: "button", name: "" }), null);
  assert.equal(teachStep({ act: "type", field: "Search", value: "oat milk" }), 'Typed "oat milk" in "Search"');
  assert.equal(teachStep({ act: "type", field: "Password", value: null }), 'Typed a password or other secret (not recorded) in "Password"');
  assert.equal(teachStep({ act: "type", field: "Note", value: "sk-abcdefghijklmnopqrstuvwx" }), 'Typed a password or other secret (not recorded) in "Note"');
  assert.equal(teachStep({ act: "choose", field: "Size", value: "Large" }), 'Chose "Large" in "Size"');
  assert.equal(teachStep({ act: "eval" }), null);
});

test("a recording does not repeat a step", () => {
  const steps = [];
  addStep(steps, { act: "open", url: "https://shop.test/?from=ad" });
  addStep(steps, { act: "open", url: "https://shop.test/" });
  addStep(steps, { act: "open", url: "https://shop.test/" });
  addStep(steps, { act: "type", field: "Search", value: "oat milk" });
  addStep(steps, { act: "enter", field: "Search", value: "oat milk" });
  addStep(steps, { act: "type", field: "Search", value: "oat milk" });
  addStep(steps, { act: "enter", field: "Search", value: "" });
  assert.deepEqual(steps, ["Opened https://shop.test/", 'Typed "oat milk" in "Search" and pressed Enter', 'Pressed Enter in "Search"']);
});

test("what the user showed goes to the agent as numbered steps", () => {
  const text = teachMessage("Reorder groceries", ["Opened https://shop.test/", 'Clicked "Reorder"']);
  assert.match(text, /how to: Reorder groceries/);
  assert.match(text, /1\. Opened https:\/\/shop\.test\/\n2\. Clicked "Reorder"/);
  assert.match(text, /skill tool/);
});
