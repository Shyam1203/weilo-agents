//! Keeps the computer awake while the host runs, when the person asked for it at setup.

use std::sync::Mutex;

use tokio::process::{Child, Command};

#[derive(Default)]
pub struct KeepAwake {
    child: Mutex<Option<Child>>,
}

impl KeepAwake {
    /// Starts `caffeinate -i` (macOS) or `systemd-inhibit` (Linux), if found. Returns
    /// whether something is now keeping the computer awake.
    pub fn start(&self) -> bool {
        let mut slot = self.child.lock().expect("keep-awake lock");
        if slot.is_some() {
            return true;
        }
        let Some(mut cmd) = inhibitor() else { return false };
        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        match cmd.spawn() {
            Ok(child) => {
                *slot = Some(child);
                true
            }
            Err(e) => {
                tracing::warn!("couldn't keep the computer awake: {e}");
                false
            }
        }
    }

    pub fn stop(&self) {
        // Dropping the child kills it.
        self.child.lock().expect("keep-awake lock").take();
    }
}

fn inhibitor() -> Option<Command> {
    if cfg!(target_os = "macos") {
        let mut cmd = Command::new(which("caffeinate")?);
        cmd.arg("-i");
        return Some(cmd);
    }
    let mut cmd = Command::new(which("systemd-inhibit")?);
    cmd.args(["--what=idle:sleep", "--who=Weilo", "--why=Keeps your agents working"])
        .args(["sleep", "infinity"]);
    Some(cmd)
}

/// Finds a program on PATH.
pub fn which(program: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(program))
        .find(|p| is_executable(p))
}

fn is_executable(p: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}
