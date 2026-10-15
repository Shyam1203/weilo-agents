import { root } from "./root.mjs";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { decoder, encode } from "../sandbox/frames.mjs";
import { checkSpec } from "../sandbox/spec.mjs";

mkdirSync(join(root, "isolated/a"), { recursive: true });
mkdirSync(join(root, "agent/skills/s"), { recursive: true });
symlinkSync(join(root, "workspace"), join(root, "agent/skills/link"));
const spec = { user: { uid: 2001, gid: 2001, groups: [] }, argv: ["pi"], cwd: join(root, "isolated/a"), env: { PATH: "/bin" }, umask: 2, binds: [{ path: join(root, "isolated/a") }, { path: join(root, "agent/skills/s"), ro: true }], files: { "/var/lib/weilo/pi/a/models.json": "{}" } };

test("the sandbox starts a program only as an agent's user, with only isolated places", () => {
  assert.deepEqual(checkSpec(spec), spec);
  const refused = [
    { user: { uid: 0, gid: 0, groups: [] } },
    { user: { uid: 2001, gid: 2001, groups: [2000 - 1] } },
    { binds: [{ path: join(root, "workspace") }] },
    { binds: [{ path: join(root, "agent/skills/link") }] },
    { binds: [{ path: join(root, "isolated/a/../../workspace") }] },
    { files: { "/etc/passwd": "x" } },
    { argv: [] },
    { env: { X: 1 } },
  ];
  for (const change of refused) assert.throws(() => checkSpec({ ...spec, ...change }), /refused/, JSON.stringify(change));
});

test("frames come back whole, however the bytes are cut", () => {
  const bytes = Buffer.concat([encode("o", "hello"), encode("e", Buffer.from([1, 2, 3])), encode("x", { code: 0, signal: null })]);
  const got = [];
  const feed = decoder((type, data) => got.push([type, data.toString("latin1")]));
  for (let i = 0; i < bytes.length; i += 3) feed(bytes.subarray(i, i + 3));
  assert.deepEqual(got, [["o", "hello"], ["e", "\u0001\u0002\u0003"], ["x", '{"code":0,"signal":null}']]);
});
