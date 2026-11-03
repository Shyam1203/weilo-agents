//! Keeps the computer awake while the host runs, when the person asked for it at setup.
//! Only on mains power: a laptop on battery is left to sleep as usual. macOS does this
//! itself (`caffeinate -s`); on Linux the host looks at `/sys/class/power_supply` every
//! minute and holds `systemd-inhibit` only while plugged in. Either helper ends when
//! the host does, even if it crashes: `caffeinate -w <host pid>` watches the host, and
//! on Linux `systemd-inhibit` gets PDEATHSIG and holds `tail --pid=<host pid>`.

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use tokio::process::{Child, Command};
use tokio::task::JoinHandle;

const POWER_SUPPLY: &str = "/sys/class/power_supply";
const LOOK_EVERY: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct KeepAwake {
    task: Mutex<Option<JoinHandle<()>>>,
}

impl KeepAwake {
    /// Starts keeping the computer awake (while on mains power). Returns false when
    /// nothing here can do it.
    pub fn start(&self) -> bool {
        let mut slot = self.task.lock().expect("keep-awake lock");
        if slot.is_some() {
            return true;
        }
        if inhibitor().is_none() {
            return false;
        }
        *slot = Some(tokio::spawn(async {
            let mut child: Option<Child> = None;
            loop {
                let plugged_in = cfg!(target_os = "macos") || on_mains(Path::new(POWER_SUPPLY));
                if !plugged_in {
                    // Dropping the child ends it.
                    child = None;
                } else if child.is_none() {
                    child = spawn();
                }
                tokio::time::sleep(LOOK_EVERY).await;
            }
        }));
        true
    }

    pub fn stop(&self) {
        if let Some(task) = self.task.lock().expect("keep-awake lock").take() {
            task.abort();
        }
    }
}

fn spawn() -> Option<Child> {
    let mut cmd = inhibitor()?;
    crate::engines::process::die_with_host(&mut cmd);
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    match cmd.spawn() {
        Ok(child) => Some(child),
        Err(e) => {
            tracing::warn!("couldn't keep the computer awake: {e}");
            None
        }
    }
}

fn inhibitor() -> Option<Command> {
    let macos = cfg!(target_os = "macos");
    let program = which(if macos {
        "caffeinate"
    } else {
        "systemd-inhibit"
    })?;
    let mut cmd = Command::new(program);
    cmd.args(inhibitor_args(macos, std::process::id()));
    Some(cmd)
}

/// The helper's arguments; both end when the host (`pid`) is gone.
fn inhibitor_args(macos: bool, pid: u32) -> Vec<String> {
    if macos {
        // -s: only while on AC power. -w: until the host exits.
        return vec!["-s".into(), "-w".into(), pid.to_string()];
    }
    [
        "--what=idle:sleep",
        "--who=Weilo",
        "--why=Keeps your agents working",
        "tail",
        &format!("--pid={pid}"),
        "-f",
        "/dev/null",
    ]
    .map(String::from)
    .to_vec()
}

/// True when on mains power: a mains supply is online, or there is no battery at all
/// (a desktop). Batteries of devices (`scope` is `Device`: a wireless mouse or a
/// keyboard) don't make a computer a laptop.
fn on_mains(dir: &Path) -> bool {
    let read = |p: &Path, name: &str| {
        std::fs::read_to_string(p.join(name))
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    };
    let mut battery = false;
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = entry.path();
        if read(&p, "scope") == "Device" {
            continue;
        }
        match read(&p, "type").as_str() {
            "Mains" | "USB" if read(&p, "online") == "1" => return true,
            "Battery" => battery = true,
            _ => {}
        }
    }
    !battery
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

#[cfg(test)]
mod tests {
    use super::{inhibitor_args, on_mains};

    fn supply(dir: &std::path::Path, name: &str, kind: &str, online: Option<&str>) {
        let d = dir.join(name);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("type"), format!("{kind}\n")).unwrap();
        if let Some(o) = online {
            std::fs::write(d.join("online"), format!("{o}\n")).unwrap();
        }
    }

    #[test]
    fn stays_awake_only_when_plugged_in() {
        let desktop = tempfile::tempdir().unwrap();
        assert!(on_mains(desktop.path()));

        let laptop = tempfile::tempdir().unwrap();
        supply(laptop.path(), "BAT0", "Battery", None);
        supply(laptop.path(), "AC", "Mains", Some("0"));
        assert!(!on_mains(laptop.path()));
        supply(laptop.path(), "AC", "Mains", Some("1"));
        assert!(on_mains(laptop.path()));
    }

    #[test]
    fn a_wireless_mouse_battery_doesnt_make_a_laptop() {
        let desktop = tempfile::tempdir().unwrap();
        supply(desktop.path(), "hidpp_battery_0", "Battery", None);
        std::fs::write(desktop.path().join("hidpp_battery_0/scope"), "Device\n").unwrap();
        assert!(on_mains(desktop.path()));
    }

    #[test]
    fn helpers_end_with_the_host() {
        assert_eq!(inhibitor_args(true, 42), ["-s", "-w", "42"]);
        let linux = inhibitor_args(false, 42);
        assert!(linux.ends_with(&[
            "tail".into(),
            "--pid=42".into(),
            "-f".into(),
            "/dev/null".into()
        ]));
        assert!(linux.contains(&"--what=idle:sleep".to_string()));
    }
}
