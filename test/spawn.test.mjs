// The daemon runs as root: every program it starts is named by its full path (config.mjs BIN), never found by name in a
// PATH that may hold a folder agents can write to. This reads the daemon's code for a program started by a bare name.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const DAEMON = new URL("../daemon/", import.meta.url).pathname;

// A call that starts a program, with the program given as a string: its first argument (spawnAs: its second, after the
// user; spawnPi: the first of its list; find's -exec: the word after it; screen.mjs keep: the second, after its name).
const STARTS = [
  /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|run)\(\s*(["'`])(.*?)\1/g,
  /\bspawnAs\([^,()]+,\s*(["'`])(.*?)\1/g,
  /\bspawnPi\(\s*\[\s*(["'`])(.*?)\1/g,
  /"-exec",\s*(["'`])(.*?)\1/g,
  /\bkeep\(\s*"[^"]*",\s*(["'`])(.*?)\1/g,
];

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (/\.(mjs|js)$/.test(entry.name)) yield path;
  }
}

test("the daemon starts no program by a bare name", async () => {
  const bare = [];
  for await (const file of files(DAEMON)) {
    const code = await readFile(file, "utf8");
    for (const pattern of STARTS) for (const [, , program] of code.matchAll(pattern)) if (!program.startsWith("/")) bare.push(`${file.slice(DAEMON.length)}: ${program}`);
  }
  assert.deepEqual(bare, []);
});

test("the programs the daemon starts are full paths in root's folders", async () => {
  const { BIN, SYSTEM_PATH } = await import("../daemon/config.mjs");
  const folders = SYSTEM_PATH.split(":");
  for (const path of Object.values(BIN)) assert.ok(folders.some((f) => path.startsWith(`${f}/`)), path);
  assert.ok(!SYSTEM_PATH.includes(".local"));
});
