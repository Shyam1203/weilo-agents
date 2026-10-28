//! Runs the embedded Postgres: finds the binaries, creates the cluster on first run,
//! starts it on a Unix socket only, and stops it cleanly.
//!
//! When the host runs as root (containers), Postgres refuses to run as root, so
//! `initdb` and `postgres` run as a dedicated user (`WEILO_PG_USER`, default `weilo`),
//! created with `useradd` when missing. That user must be able to pass through the
//! home folder; when it can't (for example `/root` is 0700), the cluster lives in
//! `/var/lib/weilo-agents/<hash of home>` instead.

use std::ffi::CString;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Connection;
use sqlx::postgres::{PgConnectOptions, PgConnection};
use tokio::process::{Child, Command};

use crate::home::{Home, ensure_private_dir, write_private};

pub const ADMIN_ROLE: &str = "weilo_admin";
pub const OWNER_ROLE: &str = "weilo_owner";
pub const APP_ROLE: &str = "weilo_app";
pub const DATABASE: &str = "weilo";

/// Passwords and the port, kept in `HOME/secrets/pg.json` (0600).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgSecrets {
    pub port: u16,
    pub admin_password: String,
    pub owner_password: String,
    pub app_password: String,
}

/// The OS user Postgres runs as, when it isn't us.
#[derive(Debug, Clone)]
pub struct RunAs {
    pub name: String,
    pub uid: u32,
    pub gid: u32,
}

#[derive(Debug, Clone)]
pub struct Layout {
    pub bin_dir: PathBuf,
    pub data_dir: PathBuf,
    pub socket_dir: PathBuf,
    pub log_file: PathBuf,
    pub run_as: Option<RunAs>,
}

pub struct Postgres {
    child: Option<Child>,
    pub layout: Layout,
    pub secrets: PgSecrets,
}

impl Postgres {
    /// Creates the cluster if needed, starts it, and makes sure the roles and database exist.
    pub async fn start(home: &Home) -> Result<Self> {
        let run_as = run_as_user()?;
        let layout = layout(home, run_as)?;
        home.ensure(if layout.run_as.is_some() { 0o711 } else { 0o700 })?;
        let secrets = load_or_create_secrets(home)?;
        prepare_dirs(&layout)?;
        if !layout.data_dir.join("PG_VERSION").exists() {
            initdb(&layout, &secrets).await?;
        }
        clear_stale_pid(&layout).await?;
        let child = spawn_postgres(&layout, secrets.port)?;
        let mut pg = Self { child: Some(child), layout, secrets };
        if let Err(e) = pg.wait_ready().await {
            pg.stop().await;
            return Err(e);
        }
        pg.bootstrap().await?;
        Ok(pg)
    }

    pub fn options(&self, role: &str, database: &str) -> PgConnectOptions {
        let password = match role {
            ADMIN_ROLE => &self.secrets.admin_password,
            OWNER_ROLE => &self.secrets.owner_password,
            _ => &self.secrets.app_password,
        };
        PgConnectOptions::new()
            .socket(&self.layout.socket_dir)
            .port(self.secrets.port)
            .username(role)
            .password(password)
            .database(database)
    }

    async fn wait_ready(&mut self) -> Result<()> {
        let opts = self.options(ADMIN_ROLE, "postgres");
        for _ in 0..300 {
            if let Some(child) = self.child.as_mut()
                && let Some(status) = child.try_wait()?
            {
                bail!("Postgres stopped at start ({status}). {}", self.log_tail());
            }
            if let Ok(conn) = PgConnection::connect_with(&opts).await {
                conn.close().await.ok();
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        bail!("Postgres didn't start in 30 s. {}", self.log_tail())
    }

    fn log_tail(&self) -> String {
        let text = fs::read_to_string(&self.layout.log_file).unwrap_or_default();
        let lines: Vec<&str> = text.lines().rev().take(5).collect();
        lines.into_iter().rev().collect::<Vec<_>>().join("\n")
    }

    /// Roles and database. Safe to run on every start.
    async fn bootstrap(&self) -> Result<()> {
        let mut conn = PgConnection::connect_with(&self.options(ADMIN_ROLE, "postgres")).await?;
        for (role, password, extra) in [
            (OWNER_ROLE, &self.secrets.owner_password, ""),
            (APP_ROLE, &self.secrets.app_password, " NOBYPASSRLS"),
        ] {
            let exists: bool =
                sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)")
                    .bind(role)
                    .fetch_one(&mut conn)
                    .await?;
            let verb = if exists { "ALTER" } else { "CREATE" };
            let sql = format!(
                "{verb} ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE{extra} PASSWORD {}",
                quote_literal(password)
            );
            sqlx::raw_sql(&sql).execute(&mut conn).await?;
        }
        let has_db: bool =
            sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)")
                .bind(DATABASE)
                .fetch_one(&mut conn)
                .await?;
        if !has_db {
            let sql = format!("CREATE DATABASE {DATABASE} OWNER {OWNER_ROLE} ENCODING 'UTF8'");
            sqlx::raw_sql(&sql).execute(&mut conn).await?;
        }
        let sql = format!(
            "REVOKE ALL ON DATABASE {DATABASE} FROM PUBLIC; \
             GRANT CONNECT, TEMPORARY ON DATABASE {DATABASE} TO {APP_ROLE};"
        );
        sqlx::raw_sql(&sql).execute(&mut conn).await?;
        conn.close().await?;
        Ok(())
    }

    /// Fast shutdown (SIGINT), then SIGQUIT if it takes over 15 s.
    pub async fn stop(&mut self) {
        let Some(mut child) = self.child.take() else { return };
        let Some(pid) = child.id() else { return };
        signal(pid, libc::SIGINT);
        match tokio::time::timeout(Duration::from_secs(15), child.wait()).await {
            Ok(_) => tracing::info!("Postgres stopped"),
            Err(_) => {
                signal(pid, libc::SIGQUIT);
                let _ = child.wait().await;
                tracing::warn!("Postgres was slow to stop and was forced");
            }
        }
    }
}

impl Drop for Postgres {
    fn drop(&mut self) {
        if let Some(pid) = self.child.as_ref().and_then(Child::id) {
            signal(pid, libc::SIGINT);
        }
    }
}

fn signal(pid: u32, sig: i32) {
    // SAFETY: kill(2) with a pid we spawned.
    unsafe {
        libc::kill(pid as i32, sig);
    }
}

fn quote_literal(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// `WEILO_PG_BIN`, then `pg_config --bindir`, then the highest `/usr/lib/postgresql/*/bin`.
pub fn find_bin_dir() -> Result<PathBuf> {
    if let Some(dir) = std::env::var_os("WEILO_PG_BIN") {
        return Ok(PathBuf::from(dir));
    }
    if let Ok(out) = std::process::Command::new("pg_config").arg("--bindir").output()
        && out.status.success()
    {
        let dir = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
        if dir.join("initdb").exists() {
            return Ok(dir);
        }
    }
    let mut found: Vec<(u32, PathBuf)> = fs::read_dir("/usr/lib/postgresql")
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let major = e.file_name().to_str()?.parse::<u32>().ok()?;
            let bin = e.path().join("bin");
            bin.join("initdb").exists().then_some((major, bin))
        })
        .collect();
    found.sort();
    found
        .pop()
        .map(|(_, p)| p)
        .ok_or_else(|| anyhow!("Postgres isn't installed. Set WEILO_PG_BIN to its bin folder."))
}

fn run_as_user() -> Result<Option<RunAs>> {
    // SAFETY: geteuid has no preconditions.
    if unsafe { libc::geteuid() } != 0 {
        return Ok(None);
    }
    let name = std::env::var("WEILO_PG_USER").unwrap_or_else(|_| "weilo".into());
    if let Some(user) = lookup_user(&name) {
        return Ok(Some(user));
    }
    let status = std::process::Command::new("useradd")
        .args(["--system", "--no-create-home", "--shell", "/usr/sbin/nologin", &name])
        .stderr(Stdio::null())
        .status();
    // Another process may have created it at the same time, so look again either way.
    lookup_user(&name).map(Some).ok_or_else(|| {
        anyhow!("Couldn't create the user `{name}` for Postgres ({status:?}). Set WEILO_PG_USER.")
    })
}

fn lookup_user(name: &str) -> Option<RunAs> {
    let cname = CString::new(name).ok()?;
    // SAFETY: getpwnam returns a pointer to static storage or null; we copy out at once.
    let pw = unsafe { libc::getpwnam(cname.as_ptr()) };
    if pw.is_null() {
        return None;
    }
    // SAFETY: checked non-null above.
    let (uid, gid) = unsafe { ((*pw).pw_uid, (*pw).pw_gid) };
    Some(RunAs { name: name.to_string(), uid, gid })
}

pub fn layout(home: &Home, run_as: Option<RunAs>) -> Result<Layout> {
    let bin_dir = find_bin_dir()?;
    let data_root = match &run_as {
        Some(_) if !others_can_pass(home.root()) => {
            let hash = hex::encode(&Sha256::digest(home.root().as_os_str().as_encoded_bytes())[..8]);
            let dir = PathBuf::from("/var/lib/weilo-agents").join(hash);
            tracing::info!("Postgres data lives in {} (home isn't reachable)", dir.display());
            dir
        }
        _ => home.root().to_path_buf(),
    };
    Ok(Layout {
        bin_dir,
        data_dir: data_root.join("db"),
        socket_dir: data_root.join("run"),
        log_file: home.logs().join("postgres.log"),
        run_as,
    })
}

/// True when every folder above `dir` lets other users pass through.
fn others_can_pass(dir: &Path) -> bool {
    dir.ancestors().skip(1).all(|p| {
        fs::metadata(p).map(|m| m.permissions().mode() & 0o001 != 0).unwrap_or(false)
    })
}

fn load_or_create_secrets(home: &Home) -> Result<PgSecrets> {
    let path = home.secrets().join("pg.json");
    if let Ok(bytes) = fs::read(&path) {
        return serde_json::from_slice(&bytes).context("HOME/secrets/pg.json is damaged");
    }
    let secrets = PgSecrets {
        port: 15432 + rand::rng().random_range(0..1000),
        admin_password: random_secret(),
        owner_password: random_secret(),
        app_password: random_secret(),
    };
    write_private(&path, &serde_json::to_vec_pretty(&secrets)?)?;
    Ok(secrets)
}

pub fn random_secret() -> String {
    let bytes: [u8; 24] = rand::rng().random();
    hex::encode(bytes)
}

fn prepare_dirs(layout: &Layout) -> Result<()> {
    for dir in [&layout.data_dir, &layout.socket_dir] {
        if let Some(parent) = dir.parent() {
            fs::create_dir_all(parent)?;
        }
        ensure_private_dir(dir)?;
        if let Some(user) = &layout.run_as {
            std::os::unix::fs::chown(dir, Some(user.uid), Some(user.gid))?;
        }
    }
    if let Some(logs) = layout.log_file.parent() {
        ensure_private_dir(logs)?;
    }
    Ok(())
}

fn command(layout: &Layout, program: &str) -> Command {
    let mut cmd = Command::new(layout.bin_dir.join(program));
    if let Some(user) = &layout.run_as {
        cmd.uid(user.uid).gid(user.gid);
        // SAFETY: setgroups is async-signal-safe; it drops root's extra groups.
        unsafe {
            cmd.pre_exec(|| {
                libc::setgroups(0, std::ptr::null());
                Ok(())
            });
        }
    }
    cmd.env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LANG", "C.UTF-8")
        .current_dir(&layout.socket_dir);
    cmd
}

async fn initdb(layout: &Layout, secrets: &PgSecrets) -> Result<()> {
    let pwfile = layout.socket_dir.join("initdb.pw");
    write_private(&pwfile, secrets.admin_password.as_bytes())?;
    if let Some(user) = &layout.run_as {
        std::os::unix::fs::chown(&pwfile, Some(user.uid), Some(user.gid))?;
    }
    let out = command(layout, "initdb")
        .arg("-D")
        .arg(&layout.data_dir)
        .args(["-U", ADMIN_ROLE, "--auth=scram-sha-256", "--data-checksums", "-E", "UTF8"])
        .args(["--locale=C", "--no-instructions"])
        .arg(format!("--pwfile={}", pwfile.display()))
        .output()
        .await
        .context("couldn't run initdb")?;
    let _ = fs::remove_file(&pwfile);
    if !out.status.success() {
        // Leave an empty folder so the next start tries again.
        let _ = fs::remove_dir_all(&layout.data_dir);
        bail!("initdb failed: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(())
}

/// Removes `postmaster.pid` when its process is gone. A live Postgres left over from an
/// earlier run of this home is stopped first.
async fn clear_stale_pid(layout: &Layout) -> Result<()> {
    let pid_file = layout.data_dir.join("postmaster.pid");
    let Ok(text) = fs::read_to_string(&pid_file) else { return Ok(()) };
    let Some(pid) = text.lines().next().and_then(|l| l.trim().parse::<i32>().ok()) else {
        fs::remove_file(&pid_file)?;
        return Ok(());
    };
    if !process_alive(pid) {
        tracing::info!("Clearing a stale postmaster.pid ({pid})");
        fs::remove_file(&pid_file)?;
        return Ok(());
    }
    tracing::warn!("Stopping a Postgres left from an earlier run ({pid})");
    signal(pid as u32, libc::SIGINT);
    for _ in 0..150 {
        if !process_alive(pid) {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    bail!("Another Postgres ({pid}) is using this home folder.")
}

fn process_alive(pid: i32) -> bool {
    // SAFETY: signal 0 only checks that the process exists.
    let rc = unsafe { libc::kill(pid, 0) };
    rc == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

fn spawn_postgres(layout: &Layout, port: u16) -> Result<Child> {
    let log = fs::OpenOptions::new().create(true).append(true).open(&layout.log_file)?;
    let mut cmd = command(layout, "postgres");
    cmd.arg("-D")
        .arg(&layout.data_dir)
        .arg("-k")
        .arg(&layout.socket_dir)
        .args(["-p", &port.to_string()])
        .args(["-c", "listen_addresses="])
        .args(["-c", "shared_buffers=32MB"])
        .args(["-c", "max_connections=20"])
        .args(["-c", "work_mem=4MB"])
        .args(["-c", "unix_socket_permissions=0700"])
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log)
        // Its own process group, so a ctrl-c in the terminal reaches only us; we stop it.
        .process_group(0);
    if cfg!(target_os = "macos") {
        cmd.args(["-c", "wal_sync_method=fsync_writethrough"]);
    }
    cmd.spawn().context("couldn't start postgres")
}
