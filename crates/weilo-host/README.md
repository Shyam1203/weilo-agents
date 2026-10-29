# weilo-host

The core of Weilo, as one binary named `weilo`. It runs an embedded Postgres, starts
engines (ACP agents such as Claude Code, Codex or the built-in `echo`), keeps the event
log, and serves the web app and its WebSocket on `127.0.0.1`. The protocol it speaks is
`crates/weilo-proto`.

## Run it

```sh
cargo run -p weilo-host -- up            # http://127.0.0.1:3210
cargo run -p weilo-host -- pair          # one-time code to connect a browser (10 min)
cargo run -p weilo-host -- engine echo   # the test engine, over stdio
cargo run -p weilo-host -- version
```

`weilo up --home DIR --port N --web DIR`: `--port 0` picks a free port (written to
`HOME/host.json`). `weilo pair` asks the running host over `HOME/admin.sock` (0600, same
user only), so only you can mint codes.

## Environment

| Variable | What it does |
|---|---|
| `WEILO_HOME` | Data folder (default `~/.weilo-agents`) |
| `WEILO_WEB` | The built web app (default `apps/web/dist` in the repo, or `web/` beside the binary) |
| `WEILO_PG_BIN` | Postgres `bin` folder. By default the one matching `HOME/db/PG_VERSION`; a new cluster takes the newest Postgres 16 or newer (`pg_config --bindir`, `/usr/lib/postgresql/*/bin`, Homebrew `postgresql@*`) |
| `WEILO_PG_USER` | When run as root: the user Postgres runs as (default `weilo`, created with `useradd` if missing) |
| `WEILO_APPROVAL_TTL_SECS` | How long an approval waits (default 24 h) |
| `WEILO_ENGINE_IDLE_SECS` | Idle engines stop after this (default 600) |
| `WEILO_JOB_POLL_MS` | Job queue poll interval (default 1000) |
| `WEILO_WORKSPACES` | Where chat agents get their folders (absolute path; default `~/Weilo/agents`) |
| `WEILO_MAX_ENGINES` | Most engine processes running at once (default 8) |
| `WEILO_MAX_SOCKETS` | Most open WebSockets (default 128) |
| `WEILO_RUNNER_IDLE_SECS` | A quiet thread's runner ends after this (default 900) |
| `WEILO_DB_WAIT_SECS` | How long a database call waits for a connection (default 30) |
| `RUST_LOG` | Log filter (logs go to stderr; Postgres and engine logs to `HOME/logs`) |

Postgres listens on a Unix socket only (`HOME/run`), with data in `HOME/db`. Sign-in is
by OS user (peer auth, no passwords). Setup and migrations run as the admin and
`weilo_owner`; then `pg_ident` is cut down to `weilo_app` alone and Postgres reloads, so
while Weilo runs only `weilo_app` can sign in (not superuser, no BYPASSRLS, insert-only on
`audit` and `events`). `weilo audit verify --home DIR` checks the audit hash chain; `up`
also checks it at start and warns if it was changed.

**As root** (containers), Postgres refuses to run, so it runs as `WEILO_PG_USER`. That
user must pass through the home folder: the host makes home `0711`, and if a parent is
closed (like `/root`), the cluster lives in `/var/lib/weilo-agents/<hash>` instead.

## Tests

```sh
cargo test -p weilo-host
```

Unit tests need nothing. `tests/host.rs` boots a real `weilo up` per test on a temp home
and a free port, pairs through `weilo pair` and `/api/pair`, and drives the echo engine
over the WebSocket; `tests/db.rs` checks fencing, the audit chain and role grants. Both
find Postgres as above and skip with a message when it isn't installed.
