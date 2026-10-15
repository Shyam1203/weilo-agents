import { root } from "./root.mjs";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { serveFile } from "../http/files.mjs";

const workspace = join(root, "workspace");
const home = join(workspace, "me");
mkdirSync(join(home, "notes"), { recursive: true });
writeFileSync(join(home, "notes/plan.md"), "# Plan");
writeFileSync(join(root, "agent/auth.json"), "{}");
symlinkSync(join(root, "agent/auth.json"), join(home, "keys.json"));

const response = () => Object.assign(new PassThrough(), { status: 0, headers: {}, writeHead(status, headers) { Object.assign(this, { status, headers }); } });

const where = { folders: [home, workspace], roots: [workspace] };

test("a file is served from the agent's folder, plainly and sandboxed", async () => {
  const res = response();
  await serveFile(res, where, "notes/plan.md", true);
  assert.equal(res.status, 200);
  assert.equal(res.headers["Content-Type"], "text/plain; charset=utf-8");
  assert.equal(res.headers["Content-Security-Policy"], "sandbox");
});

test("nothing outside the roots is served, by a path or by a link", async () => {
  for (const path of ["../agent/auth.json", "keys.json", join(root, "agent/auth.json"), "%2e%2e/%2e%2e/agent/auth.json", "missing.md"]) {
    await assert.rejects(serveFile(response(), where, path), { status: 404 }, path);
  }
});
