import { realpathSync } from "node:fs";
import { isAbsolute, normalize, sep } from "node:path";
import { EXTENSIONS, ISOLATED, ISOLATED_HOMES, ISOLATED_SESSIONS, RUN, SKILLS } from "../common.mjs";
import { FIRST_AGENT_UID } from "../config.mjs";

const BIND_ROOTS = [ISOLATED, ISOLATED_SESSIONS, ISOLATED_HOMES, SKILLS, EXTENSIONS];

const id = (n) => Number.isInteger(n) && n >= FIRST_AGENT_UID;
const strings = (list) => Array.isArray(list) && list.length > 0 && list.every((s) => typeof s === "string");
const under = (path, roots) => isAbsolute(path) && normalize(path) === path && roots.some((root) => path.startsWith(root + sep));
const real = (path) => {
  try {
    return realpathSync(path) === path;
  } catch {
    return false;
  }
};

export function checkSpec(spec) {
  const { user, argv, cwd, env, umask, binds = [], files = {} } = spec ?? {};
  const ok =
    id(user?.uid) && id(user.gid) && Array.isArray(user.groups) && user.groups.every(id) &&
    strings(argv) && typeof cwd === "string" && isAbsolute(cwd) &&
    env && typeof env === "object" && Object.values(env).every((v) => typeof v === "string") &&
    Number.isInteger(umask) && umask >= 0 && umask <= 0o777 &&
    Array.isArray(binds) && binds.every((b) => typeof b?.path === "string" && under(b.path, BIND_ROOTS) && real(b.path)) &&
    files && typeof files === "object" && Object.entries(files).every(([path, text]) => under(path, [RUN]) && typeof text === "string");
  if (!ok) throw new Error("The sandbox refused a program it was asked to start");
  return { user, argv, cwd, env, umask, binds, files };
}
