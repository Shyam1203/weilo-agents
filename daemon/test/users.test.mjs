import { root } from "./root.mjs";
import assert from "node:assert/strict";
import { mkdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { isRoot, tree } from "../users.mjs";

test("owners and modes change inside a real folder, never through a link to another", { skip: !isRoot && "needs root" }, async () => {
  const [home, secret, link] = ["home", "secret", "link"].map((name) => join(root, "users", name));
  mkdirSync(join(home, "sub"), { recursive: true });
  mkdirSync(secret, { recursive: true, mode: 0o700 });
  writeFileSync(join(secret, "key"), "x", { mode: 0o600 });
  symlinkSync(secret, link);
  symlinkSync(secret, join(home, "sub", "out"));
  await tree(link, 4321, 4321, "ug+rwX,o+rX");
  await tree(home, 4321, 4321, "ug+rwX,o+rX");
  assert.equal(statSync(join(secret, "key")).uid, 0);
  assert.equal(statSync(join(secret, "key")).mode & 0o777, 0o600);
  assert.equal(statSync(secret).mode & 0o777, 0o700);
  assert.equal(statSync(join(home, "sub")).uid, 4321);
  assert.equal(statSync(join(home, "sub")).mode & 0o2775, 0o2775);
});
