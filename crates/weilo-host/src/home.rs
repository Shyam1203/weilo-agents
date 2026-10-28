//! The host's home folder (`~/.weilo-agents` by default) and the paths inside it.

use std::fs;
use std::io;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub struct Home {
    root: PathBuf,
}

impl Home {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// `--home`, then `WEILO_HOME`, then `~/.weilo-agents`.
    pub fn resolve(arg: Option<PathBuf>) -> io::Result<Self> {
        if let Some(dir) = arg.or_else(|| std::env::var_os("WEILO_HOME").map(PathBuf::from)) {
            return Ok(Self::new(absolute(&dir)?));
        }
        let base = dirs::home_dir()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no home folder"))?;
        Ok(Self::new(base.join(".weilo-agents")))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn secrets(&self) -> PathBuf {
        self.root.join("secrets")
    }
    pub fn logs(&self) -> PathBuf {
        self.root.join("logs")
    }
    pub fn engines(&self) -> PathBuf {
        self.root.join("engines")
    }
    pub fn engine_install(&self, engine: &str) -> PathBuf {
        self.engines().join(engine)
    }
    /// One folder per engine for its own files (`{engine_home}` in manifests), shared by
    /// every thread, so a sign-in made there lasts.
    pub fn engine_state(&self, engine: &str) -> PathBuf {
        self.root.join("engines-state").join(engine)
    }
    /// API keys saved for an engine (`set_engine_key`), 0600.
    pub fn engine_keys(&self, engine: &str) -> PathBuf {
        self.secrets().join(format!("keys-{engine}.json"))
    }
    pub fn workspace(&self, agent_slug: &str) -> PathBuf {
        self.root.join("workspace").join(agent_slug)
    }
    /// A Unix socket path must be short (about 100 bytes), so the admin socket lives in
    /// `$XDG_RUNTIME_DIR` or `/tmp/weilo-<uid>` (0700), named after this home.
    pub fn admin_socket(&self) -> PathBuf {
        let hash = hex::encode(&Sha256::digest(self.root.as_os_str().as_encoded_bytes())[..6]);
        runtime_dir().join(format!("weilo-{hash}.sock"))
    }
    /// Held (flock) while `weilo up` runs, so only one host uses this home.
    pub fn lock_file(&self) -> PathBuf {
        self.root.join("lock")
    }
    /// Written while the host runs: its port and pid.
    pub fn host_file(&self) -> PathBuf {
        self.root.join("host.json")
    }

    /// Creates the folder with `mode` (0700, or 0711 when Postgres runs as another user
    /// and must pass through it).
    pub fn ensure(&self, mode: u32) -> io::Result<()> {
        fs::create_dir_all(&self.root)?;
        fs::set_permissions(&self.root, fs::Permissions::from_mode(mode))?;
        for dir in [self.secrets(), self.logs()] {
            ensure_private_dir(&dir)?;
        }
        Ok(())
    }
}

/// `$XDG_RUNTIME_DIR` when it's set and short, else `/tmp/weilo-<uid>`.
pub fn runtime_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from)
        && dir.is_absolute()
        && dir.as_os_str().len() < 60
    {
        return dir;
    }
    // SAFETY: geteuid has no preconditions.
    PathBuf::from(format!("/tmp/weilo-{}", unsafe { libc::geteuid() }))
}

/// Makes the runtime folder: ours, 0700, and not a link someone else planted.
pub fn ensure_runtime_dir(dir: &Path) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt;
    match fs::DirBuilder::new().mode(0o700).create(dir) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(e),
    }
    let meta = fs::symlink_metadata(dir)?;
    // SAFETY: geteuid has no preconditions.
    if !meta.is_dir() || meta.uid() != unsafe { libc::geteuid() } {
        return Err(io::Error::other(format!(
            "{} belongs to someone else",
            dir.display()
        )));
    }
    if meta.mode() & 0o077 != 0 {
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Takes the home's lock without waiting. `None` when another host holds it. The lock
/// lasts as long as the returned file is open.
pub fn try_lock(path: &Path) -> io::Result<Option<fs::File>> {
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::OpenOptionsExt;
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .mode(0o600)
        .open(path)?;
    // SAFETY: flock on a file descriptor we own.
    let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if rc == 0 {
        return Ok(Some(file));
    }
    let err = io::Error::last_os_error();
    if err.raw_os_error() == Some(libc::EWOULDBLOCK) {
        Ok(None)
    } else {
        Err(err)
    }
}

/// True when `inner` is `outer` or inside it (both made absolute and resolved first).
pub fn is_within(inner: &Path, outer: &Path) -> bool {
    let resolve = |p: &Path| fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    resolve(inner).starts_with(resolve(outer))
}

pub fn ensure_private_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
}

/// Writes a file only the owner can read.
pub fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let tmp = path.with_extension("tmp");
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    fs::rename(tmp, path)
}

fn absolute(p: &Path) -> io::Result<PathBuf> {
    if p.is_absolute() {
        Ok(p.to_path_buf())
    } else {
        Ok(std::env::current_dir()?.join(p))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admin_socket_is_short_even_for_a_long_home() {
        let long = "/tmp/".to_string() + &"a-very-long-folder-name/".repeat(10);
        let sock = Home::new(long).admin_socket();
        assert!(sock.as_os_str().len() < 100, "{}", sock.display());
    }

    #[test]
    fn a_second_lock_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lock");
        let first = try_lock(&path).unwrap();
        assert!(first.is_some());
        assert!(try_lock(&path).unwrap().is_none());
        drop(first);
        assert!(try_lock(&path).unwrap().is_some());
    }

    #[test]
    fn within_follows_the_real_path() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().join("home");
        fs::create_dir_all(home.join("workspace")).unwrap();
        assert!(is_within(&home.join("workspace"), &home));
        assert!(is_within(&home.join("workspace/../workspace"), &home));
        assert!(!is_within(dir.path(), &home));
    }
}
