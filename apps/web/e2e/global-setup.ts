/**
 * Builds the host and the web app, starts a real `weilo up --port 0` on a temp home,
 * and stops it all afterwards (host, engines and Postgres). When Postgres isn't
 * installed, every test skips with a message instead.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const REPO = resolve(WEB, "../..");
const BIN = join(REPO, "target/debug/weilo");

/** Same order as the host: WEILO_PG_BIN, `pg_config --bindir`, newest /usr/lib/postgresql/N/bin. */
function findPgBin(): string | null {
  const ok = (dir: string) => existsSync(join(dir, "initdb")) && existsSync(join(dir, "pg_ctl"));
  const env = process.env.WEILO_PG_BIN;
  if (env) return ok(env) ? env : null;
  try {
    const dir = execFileSync("pg_config", ["--bindir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (ok(dir)) return dir;
  } catch {
    /* no pg_config */
  }
  const root = "/usr/lib/postgresql";
  if (!existsSync(root)) return null;
  const versions = readdirSync(root)
    .map(Number)
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a);
  for (const v of versions) if (ok(join(root, String(v), "bin"))) return join(root, String(v), "bin");
  return null;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor<T>(what: string, ms: number, check: () => T | null | undefined): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = check();
    if (v !== null && v !== undefined) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Postgres' pid from `postmaster.pid`, if it wrote one. */
function postgresPid(home: string): number | null {
  try {
    const pid = Number(readFileSync(join(home, "db/postmaster.pid"), "utf8").split("\n")[0]);
    return pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const pg = findPgBin();
  if (!pg) {
    if (process.env.WEILO_E2E_REQUIRE_PG) throw new Error("Postgres isn't installed, and WEILO_E2E_REQUIRE_PG is set.");
    const why = "Postgres isn't installed (set WEILO_PG_BIN or install postgresql-16); skipping the e2e tests.";
    console.warn(`\n  ${why}\n`);
    process.env.WEILO_E2E_SKIP = why;
    return async () => {};
  }

  const quiet = process.env.WEILO_E2E_QUIET_BUILD ? "ignore" : "inherit";
  execFileSync("cargo", ["build", "-p", "weilo-host"], { cwd: REPO, stdio: ["ignore", quiet, "inherit"] });
  execFileSync("npm", ["run", "build"], { cwd: WEB, stdio: ["ignore", quiet, "inherit"] });

  // /tmp, made passable, so Postgres (which runs as WEILO_PG_USER when we're root) can reach it.
  const dir = mkdtempSync("/tmp/weilo-e2e-");
  chmodSync(dir, 0o711);
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  // Echo is hidden from pickers; a home manifest with the same name shows it, like a real add-on.
  mkdirSync(join(home, "engines/echo"), { recursive: true });
  writeFileSync(
    join(home, "engines/echo/weilo.json"),
    JSON.stringify({
      apiVersion: 1,
      kind: "engine",
      name: "echo",
      title: "Echo",
      description: "Answers with what you wrote.",
      command: ["{self}", "engine", "echo"],
      bindsApprovals: true,
    }),
  );

  const log = join(dir, "host.log");
  const child: ChildProcess = spawn(BIN, ["up", "--port", "0", "--home", home, "--web", join(WEB, "dist")], {
    cwd: dir,
    env: { ...process.env, WEILO_PG_BIN: pg, WEILO_JOB_POLL_MS: "200", RUST_LOG: "weilo_host=debug,warn" },
    stdio: ["ignore", "ignore", openSync(log, "w")],
  });
  let exited = false;
  child.on("exit", () => (exited = true));
  const hostLog = () => (existsSync(log) ? readFileSync(log, "utf8") : "");

  const stop = async () => {
    if (child.pid && !exited) {
      child.kill("SIGTERM");
      try {
        await waitFor("the host to stop", 30_000, () => (exited ? true : null));
      } catch {
        child.kill("SIGKILL");
      }
    }
    // If the host died hard, Postgres may still be up: stop it as pg_ctl would.
    const pid = postgresPid(home);
    if (pid && alive(pid)) {
      process.kill(pid, "SIGINT");
      try {
        await waitFor("Postgres to stop", 15_000, () => (alive(pid) ? null : true));
      } catch {
        process.kill(pid, "SIGKILL");
      }
    }
    if (!process.env.WEILO_E2E_KEEP) rmSync(dir, { recursive: true, force: true });
    else console.log(`  kept ${dir}`);
  };
  // Ctrl-C or a crash in Playwright: don't leave a host behind.
  process.once("exit", () => {
    if (!exited) child.kill("SIGKILL");
  });

  let port: number;
  try {
    port = await waitFor("host.json", 90_000, () => {
      if (exited) throw new Error(`weilo up exited:\n${hostLog()}`);
      try {
        return JSON.parse(readFileSync(join(home, "host.json"), "utf8")).port as number;
      } catch {
        return null;
      }
    });
  } catch (e) {
    console.error(hostLog());
    await stop();
    throw e;
  }

  process.env.WEILO_E2E_URL = `http://127.0.0.1:${port}`;
  process.env.WEILO_E2E_HOME = home;
  process.env.WEILO_E2E_BIN = BIN;
  process.env.WEILO_E2E_STATE = join(dir, "device.json");
  process.env.WEILO_E2E_LOG = log;
  return stop;
}
