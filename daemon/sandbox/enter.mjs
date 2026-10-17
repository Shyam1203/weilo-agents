import { execFileSync, spawn } from "node:child_process";
import { closeSync, mkdirSync, readFileSync } from "node:fs";
import { constants } from "node:os";
import { dirname, join } from "node:path";
import { ROOT, RUN } from "../common.mjs";
import { BIN, SANDBOX_DIR } from "../config.mjs";
import { asUser, folder, newFile } from "../users.mjs";

const spec = JSON.parse(readFileSync(3, "utf8"));
closeSync(3);
const { user, argv, cwd, env, umask, binds, files } = spec;

const mount = (...args) => execFileSync(BIN.mount, args, { stdio: ["ignore", "ignore", "inherit"] });
const tmpfs = (path, mode) => (mkdirSync(path, { recursive: true }), mount("-t", "tmpfs", "-o", `mode=${mode},nosuid,nodev`, "tmpfs", path));
const STAGE = "/mnt";

process.umask(0o022);
mount("--make-rprivate", "/");
tmpfs(STAGE, "700");
binds.forEach(({ path, ro }, i) => {
  const at = join(STAGE, String(i));
  mkdirSync(at);
  mount("--bind", path, at);
  mount("-o", `remount,bind,nosuid,nodev${ro ? ",ro" : ""}`, at);
});
for (const path of [ROOT, RUN, SANDBOX_DIR]) tmpfs(path, "755");
for (const path of ["/tmp", "/dev/shm"]) tmpfs(path, "1777");
binds.forEach(({ path }, i) => {
  mkdirSync(path, { recursive: true });
  mount("--move", join(STAGE, String(i)), path);
});

for (const [path, text] of Object.entries(files)) {
  await folder(dirname(path), user.uid, user.gid, 0o700);
  await newFile(path, text, user.uid, user.gid, 0o600);
}

process.umask(umask);
const child = spawn(BIN.setpriv, [...asUser(user), ...argv], { cwd, env, stdio: "inherit" });
child.on("error", (err) => (console.error(err.message), process.exit(127)));
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => child.kill(constants.signals[signal]));
