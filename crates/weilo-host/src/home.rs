//! The host's home folder (`~/.weilo-agents` by default) and the paths inside it.

use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

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
    pub fn engine_home(&self, engine: &str, owner: &str) -> PathBuf {
        self.root.join("engine-homes").join(engine).join(owner)
    }
    pub fn workspace(&self, agent_slug: &str) -> PathBuf {
        self.root.join("workspace").join(agent_slug)
    }
    pub fn admin_socket(&self) -> PathBuf {
        self.root.join("admin.sock")
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
