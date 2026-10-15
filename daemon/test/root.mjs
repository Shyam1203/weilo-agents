import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const root = mkdtempSync(join(tmpdir(), "weilo-test-"));
process.env.WEILO_ROOT = root;
for (const dir of ["agent/profiles", "agent/sessions", "isolated", "isolated-sessions", "knowledge", "workspace"]) mkdirSync(join(root, dir), { recursive: true });
