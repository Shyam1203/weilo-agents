//! Runs the embedded Postgres: finds the binaries, creates the cluster on first run,
//! starts it on a Unix socket only, and stops it cleanly.
//!
//! When the host runs as root (containers), Postgres refuses to run as root, so
//! `initdb` and `postgres` run as a dedicated user (`WEILO_PG_USER`, default `weilo`),
//! created with `useradd` when missing. That user must be able to pass through the
//! home folder; when it can't (for example `/root` is 0700), the cluster lives in
//! `/var/lib/weilo-agents/<hash of home>` instead.
//!
//! Sign-in uses peer auth over the Unix socket: only the OS user running the host may
//! log in, as any of the three roles, and no password is kept on disk.
//!
//! When Postgres stops by itself, `supervise` starts it again with a growing pause and
//! tells the app, which pauses turns meanwhile.

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

/// The port, kept in `HOME/secrets/pg.json` (0600). Older homes also kept passwords
/// there; they are dropped on the next start.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgSecrets {
    pub port: u16,
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
    /// The OS user the host runs as: the only one peer auth lets in.
    pub host_user: String,
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
        home.ensure(if layout.run_as.is_some() {
            0o711
        } else {
            0o700
        })?;
        let secrets = load_or_create_secrets(home)?;
        prepare_dirs(&layout)?;
        if !layout.data_dir.join("PG_VERSION").exists() {
            initdb(&layout).await?;
        }
        let mut pg = Self {
            child: None,
            layout,
            secrets,
        };
        pg.launch().await?;
        pg.bootstrap().await?;
        Ok(pg)
    }

    /// Writes the sign-in rules, clears a stale pid file and starts the server.
    async fn launch(&mut self) -> Result<()> {
        write_auth_files(&self.layout)?;
        clear_stale_pid(&self.layout).await?;
        self.child = Some(spawn_postgres(&self.layout, self.secrets.port)?);
        if let Err(e) = self.wait_ready().await {
            self.stop().await;
            return Err(e);
        }
        Ok(())
    }

    pub fn options(&self, role: &str, database: &str) -> PgConnectOptions {
        PgConnectOptions::new()
            .socket(&self.layout.socket_dir)
            .port(self.secrets.port)
            .username(role)
            .database(database)
    }

    /// Waits until Postgres exits by itself.
    async fn exited(&mut self) -> String {
        match self.child.as_mut() {
            Some(child) => match child.wait().await {
                Ok(status) => status.to_string(),
                Err(e) => e.to_string(),
            },
            None => std::future::pending().await,
        }
    }

    /// Keeps Postgres running until `stop` is cancelled, then stops it. `up` is told
    /// when it goes down and when it is back.
    pub async fn supervise(mut self, stop: tokio_util::sync::CancellationToken, up: impl Fn(bool)) {
        let mut pause = Duration::from_millis(250);
        loop {
            let status = tokio::select! {
                status = self.exited() => status,
                _ = stop.cancelled() => break,
            };
            self.child = None;
            tracing::warn!("Postgres stopped by itself ({status}); starting it again");
            up(false);
            loop {
                tokio::select! {
                    _ = tokio::time::sleep(pause) => {}
                    _ = stop.cancelled() => return,
                }
                match self.launch().await {
                    Ok(()) => break,
                    Err(e) => {
                        tracing::warn!("Postgres didn't start again: {e:#}");
                        pause = (pause * 2).min(Duration::from_secs(30));
                    }
                }
            }
            tracing::info!("Postgres is back");
            pause = Duration::from_millis(250);
            up(true);
        }
        self.stop().await;
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

    /// Roles and database. Safe to run on every start. Roles have no password: only
    /// peer auth lets anyone in.
    async fn bootstrap(&self) -> Result<()> {
        let mut conn = PgConnection::connect_with(&self.options(ADMIN_ROLE, "postgres")).await?;
        sqlx::raw_sql(&format!("ALTER ROLE {ADMIN_ROLE} PASSWORD NULL"))
            .execute(&mut conn)
            .await?;
        for (role, extra) in [(OWNER_ROLE, ""), (APP_ROLE, " NOBYPASSRLS")] {
            let exists: bool =
                sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)")
                    .bind(role)
                    .fetch_one(&mut conn)
                    .await?;
            let verb = if exists { "ALTER" } else { "CREATE" };
            let sql = format!(
                "{verb} ROLE {role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE{extra} PASSWORD NULL"
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
        let Some(mut child) = self.child.take() else {
            return;
        };
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

/// `WEILO_PG_BIN`, then `pg_config --bindir`, then the newest Debian or Homebrew install.
pub fn find_bin_dir() -> Result<PathBuf> {
    if let Some(dir) = std::env::var_os("WEILO_PG_BIN") {
        return Ok(PathBuf::from(dir));
    }
    if let Ok(out) = std::process::Command::new("pg_config")
        .arg("--bindir")
        .output()
        && out.status.success()
    {
        let dir = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
        if dir.join("initdb").exists() {
            return Ok(dir);
        }
    }
    // Debian and Ubuntu: /usr/lib/postgresql/16/bin. Homebrew: /opt/homebrew/opt/postgresql@16/bin.
    let debian = fs::read_dir("/usr/lib/postgresql")
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            Some((
                e.file_name().to_str()?.parse::<u32>().ok()?,
                e.path().join("bin"),
            ))
        });
    let brew = ["/opt/homebrew/opt", "/usr/local/opt"]
        .into_iter()
        .flat_map(|root| fs::read_dir(root).into_iter().flatten().flatten())
        .filter_map(|e| {
            let name = e.file_name();
            let major = name
                .to_str()?
                .strip_prefix("postgresql@")?
                .parse::<u32>()
                .ok()?;
            Some((major, e.path().join("bin")))
        });
    let mut found: Vec<(u32, PathBuf)> = debian
        .chain(brew)
        .filter(|(_, bin)| bin.join("initdb").exists())
        .collect();
    found.sort();
    found
        .pop()
        .map(|(_, p)| p)
        .ok_or_else(|| anyhow!("{}", missing_postgres()))
}

/// What to do when Postgres isn't on this computer, in this computer's words.
pub fn missing_postgres() -> &'static str {
    if cfg!(target_os = "macos") {
        "Weilo needs Postgres. Install it from Terminal: brew install postgresql@16"
    } else {
        "Weilo needs Postgres. Install it from Terminal: sudo apt install postgresql"
    }
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
        .args([
            "--system",
            "--no-create-home",
            "--shell",
            "/usr/sbin/nologin",
            &name,
        ])
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
    Some(RunAs {
        name: name.to_string(),
        uid,
        gid,
    })
}

pub fn layout(home: &Home, run_as: Option<RunAs>) -> Result<Layout> {
    let bin_dir = find_bin_dir()?;
    let data_root = match &run_as {
        Some(_) if !others_can_pass(home.root()) => {
            let hash =
                hex::encode(&Sha256::digest(home.root().as_os_str().as_encoded_bytes())[..8]);
            let dir = PathBuf::from("/var/lib/weilo-agents").join(hash);
            tracing::info!(
                "Postgres data lives in {} (home isn't reachable)",
                dir.display()
            );
            dir
        }
        _ => home.root().to_path_buf(),
    };
    // A Unix socket path must fit in about 100 bytes; long homes use a short folder.
    let mut socket_dir = data_root.join("run");
    if socket_dir.as_os_str().len() + ".s.PGSQL.65535".len() + 1 > 100 {
        let hash = hex::encode(&Sha256::digest(home.root().as_os_str().as_encoded_bytes())[..6]);
        socket_dir = std::env::temp_dir().join(format!("weilo-pg-{hash}"));
    }
    Ok(Layout {
        bin_dir,
        data_dir: data_root.join("db"),
        socket_dir,
        log_file: home.logs().join("postgres.log"),
        run_as,
        host_user: host_user()?,
    })
}

/// The name of the OS user running the host.
fn host_user() -> Result<String> {
    // SAFETY: getpwuid returns static storage or null; the name is copied at once.
    unsafe {
        let pw = libc::getpwuid(libc::geteuid());
        if pw.is_null() {
            bail!("This computer's user has no name, so Postgres can't check who you are.");
        }
        Ok(std::ffi::CStr::from_ptr((*pw).pw_name)
            .to_string_lossy()
            .into_owned())
    }
}

/// Lets only the host's OS user in, over the Unix socket, as any of Weilo's roles.
fn write_auth_files(layout: &Layout) -> Result<()> {
    let user = &layout.host_user;
    if user.is_empty()
        || user
            .chars()
            .any(|c| c.is_whitespace() || c == '"' || c == '#')
    {
        bail!("This computer's user name can't be used with Postgres.");
    }
    let hba = "# Written by Weilo on every start.\nlocal all all peer map=weilo\n";
    let ident = format!(
        "# Written by Weilo on every start.\n\
         weilo {user} {ADMIN_ROLE}\nweilo {user} {OWNER_ROLE}\nweilo {user} {APP_ROLE}\n"
    );
    for (name, text) in [("pg_hba.conf", hba), ("pg_ident.conf", ident.as_str())] {
        let path = layout.data_dir.join(name);
        write_private(&path, text.as_bytes())?;
        if let Some(owner) = &layout.run_as {
            std::os::unix::fs::chown(&path, Some(owner.uid), Some(owner.gid))?;
        }
    }
    Ok(())
}

/// True when every folder above `dir` lets other users pass through.
fn others_can_pass(dir: &Path) -> bool {
    dir.ancestors().skip(1).all(|p| {
        fs::metadata(p)
            .map(|m| m.permissions().mode() & 0o001 != 0)
            .unwrap_or(false)
    })
}

fn load_or_create_secrets(home: &Home) -> Result<PgSecrets> {
    let path = home.secrets().join("pg.json");
    if let Ok(bytes) = fs::read(&path) {
        let old: serde_json::Value =
            serde_json::from_slice(&bytes).context("HOME/secrets/pg.json is damaged")?;
        let secrets: PgSecrets =
            serde_json::from_value(old.clone()).context("HOME/secrets/pg.json is damaged")?;
        // Passwords from before peer auth aren't needed any more.
        if old.as_object().is_some_and(|o| o.len() > 1) {
            write_private(&path, &serde_json::to_vec_pretty(&secrets)?)?;
        }
        return Ok(secrets);
    }
    let secrets = PgSecrets {
        port: 15432 + rand::rng().random_range(0..1000),
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

async fn initdb(layout: &Layout) -> Result<()> {
    let out = command(layout, "initdb")
        .arg("-D")
        .arg(&layout.data_dir)
        .args([
            "-U",
            ADMIN_ROLE,
            "--auth=peer",
            "--data-checksums",
            "-E",
            "UTF8",
        ])
        .args(["--locale=C", "--no-instructions"])
        .output()
        .await
        .context("couldn't run initdb")?;
    if !out.status.success() {
        // Leave an empty folder so the next start tries again.
        let _ = fs::remove_dir_all(&layout.data_dir);
        bail!(
            "initdb failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}

/// Removes `postmaster.pid` when its process is gone, or is not a Postgres for this
/// data folder (pids get reused). A live Postgres left over from an earlier run of this
/// home is stopped first.
async fn clear_stale_pid(layout: &Layout) -> Result<()> {
    let pid_file = layout.data_dir.join("postmaster.pid");
    let Ok(text) = fs::read_to_string(&pid_file) else {
        return Ok(());
    };
    let Some(pid) = text
        .lines()
        .next()
        .and_then(|l| l.trim().parse::<i32>().ok())
    else {
        fs::remove_file(&pid_file)?;
        return Ok(());
    };
    let ours = text
        .lines()
        .nth(1)
        .is_some_and(|dir| same_dir(Path::new(dir.trim()), &layout.data_dir));
    if !process_alive(pid) || !ours || !is_postgres(pid) {
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

fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// Whether the process is a Postgres server, by its program name.
fn is_postgres(pid: i32) -> bool {
    let name = match fs::read_to_string(format!("/proc/{pid}/comm")) {
        Ok(name) => name,
        Err(_) => std::process::Command::new("ps")
            .args(["-o", "comm=", "-p", &pid.to_string()])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
            .unwrap_or_default(),
    };
    let name = name.trim();
    name == "postgres" || name.ends_with("/postgres")
}

fn process_alive(pid: i32) -> bool {
    // SAFETY: signal 0 only checks that the process exists.
    let rc = unsafe { libc::kill(pid, 0) };
    rc == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

fn spawn_postgres(layout: &Layout, port: u16) -> Result<Child> {
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&layout.log_file)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn layout_in(dir: &Path) -> Layout {
        Layout {
            bin_dir: dir.into(),
            data_dir: dir.join("db"),
            socket_dir: dir.join("run"),
            log_file: dir.join("pg.log"),
            run_as: None,
            host_user: "me".into(),
        }
    }

    #[tokio::test]
    async fn a_pid_file_naming_another_program_is_stale() {
        let dir = tempfile::tempdir().unwrap();
        let layout = layout_in(dir.path());
        fs::create_dir_all(&layout.data_dir).unwrap();
        let pid_file = layout.data_dir.join("postmaster.pid");
        // This test's own pid: alive, but not a Postgres. It must not be signalled.
        let text = format!("{}\n{}\n", std::process::id(), layout.data_dir.display());
        fs::write(&pid_file, text).unwrap();
        clear_stale_pid(&layout).await.unwrap();
        assert!(!pid_file.exists());
    }

    #[tokio::test]
    async fn a_pid_file_for_another_folder_is_stale() {
        let dir = tempfile::tempdir().unwrap();
        let layout = layout_in(dir.path());
        fs::create_dir_all(&layout.data_dir).unwrap();
        let pid_file = layout.data_dir.join("postmaster.pid");
        fs::write(
            &pid_file,
            format!("{}\n/somewhere/else\n", std::process::id()),
        )
        .unwrap();
        clear_stale_pid(&layout).await.unwrap();
        assert!(!pid_file.exists());
    }

    #[test]
    fn only_the_host_user_may_sign_in() {
        let dir = tempfile::tempdir().unwrap();
        let layout = layout_in(dir.path());
        fs::create_dir_all(&layout.data_dir).unwrap();
        write_auth_files(&layout).unwrap();
        let hba = fs::read_to_string(layout.data_dir.join("pg_hba.conf")).unwrap();
        assert!(hba.contains("local all all peer map=weilo"));
        assert!(!hba.contains("host "));
        let ident = fs::read_to_string(layout.data_dir.join("pg_ident.conf")).unwrap();
        assert!(ident.contains("weilo me weilo_app"));
        assert_eq!(ident.lines().filter(|l| l.starts_with("weilo ")).count(), 3);
    }
}
