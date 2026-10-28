//! Engine processes run in their own process group, so stopping one also stops what it
//! started (shells, test runners, language servers). A group is ended with SIGTERM, then
//! SIGKILL after a grace period: when its runner drops it, and for every live group when
//! the host stops. On Linux the engine also gets SIGKILL if the host dies (PDEATHSIG).
//!
//! What an engine started lives on after a crash of the host (PDEATHSIG only reaches
//! the engine itself, and macOS has none), so every live group is also written to
//! `HOME/engines-live` with its leader's start time, and the next `weilo up` ends the
//! groups listed there before it serves.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// How long a group has to stop after SIGTERM before it gets SIGKILL.
pub const GRACE: Duration = Duration::from_secs(3);

/// Live groups, and when each one's leader started.
static LIVE: Mutex<Vec<(i32, String)>> = Mutex::new(Vec::new());
/// Where the live groups are written (`HOME/engines-live`).
static RECORD: OnceLock<PathBuf> = OnceLock::new();

/// Writes the live groups to `path` from now on.
pub fn record_in(path: PathBuf) {
    let _ = RECORD.set(path);
}

/// Puts the command in a new process group, and on Linux asks for SIGKILL when the
/// host goes away.
pub fn configure(cmd: &mut tokio::process::Command) {
    cmd.process_group(0);
    die_with_host(cmd);
}

/// On Linux, asks for SIGKILL when the host goes away (does nothing elsewhere).
pub fn die_with_host(cmd: &mut tokio::process::Command) {
    #[cfg(not(target_os = "linux"))]
    let _ = cmd;
    #[cfg(target_os = "linux")]
    {
        // SAFETY: prctl and getppid are async-signal-safe. The signal is tied to the
        // thread that forks; engines are started from the runtime's worker threads,
        // which live as long as the host.
        let host = std::process::id() as i32;
        unsafe {
            cmd.pre_exec(move || {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                // The host may have died before prctl ran.
                if libc::getppid() != host {
                    libc::_exit(1);
                }
                Ok(())
            });
        }
    }
}

/// A live process group. Dropping it ends the group.
#[derive(Debug)]
pub struct Group {
    pgid: i32,
}

impl Group {
    /// Tracks the group led by `pid` (spawned with `configure`).
    pub fn new(pid: u32) -> Self {
        let pgid = pid as i32;
        let started = start_time(pgid).unwrap_or_default();
        let mut live = LIVE.lock().expect("groups lock");
        live.push((pgid, started));
        save(&live);
        Self { pgid }
    }
}

impl Drop for Group {
    fn drop(&mut self) {
        let pgid = self.pgid;
        signal(pgid, libc::SIGTERM);
        // Waiting would block the runner, so a small thread finishes the job. The group
        // stays listed until then, so a host shutdown meanwhile still kills it.
        std::thread::spawn(move || {
            wait_gone(&[pgid], GRACE);
            signal(pgid, libc::SIGKILL);
            forget(&[pgid]);
        });
    }
}

/// Ends every live group: SIGTERM, then SIGKILL for any still there after `grace`.
pub fn kill_all(grace: Duration) {
    let groups: Vec<i32> = LIVE
        .lock()
        .expect("groups lock")
        .iter()
        .map(|(g, _)| *g)
        .collect();
    for &g in &groups {
        signal(g, libc::SIGTERM);
    }
    let left = wait_gone(&groups, grace);
    for g in left {
        signal(g, libc::SIGKILL);
    }
    forget(&groups);
}

fn forget(groups: &[i32]) {
    let mut live = LIVE.lock().expect("groups lock");
    live.retain(|(g, _)| !groups.contains(g));
    save(&live);
}

/// Writes the live groups, one `pgid start-time` per line. Call with `LIVE` held.
fn save(live: &[(i32, String)]) {
    let Some(path) = RECORD.get() else {
        return;
    };
    let text: String = live.iter().map(|(g, s)| format!("{g} {s}\n")).collect();
    if let Err(e) = crate::home::write_private(path, text.as_bytes()) {
        tracing::warn!("couldn't note the running engines: {e}");
    }
}

/// Ends the engine groups an earlier run left behind (it crashed), then forgets them.
/// A group is ended when its leader is the same process as then (same start time),
/// or when the leader is gone but the group still has processes: a group's id can't
/// be given to a new process while the group lives. Blocks up to `grace`.
pub fn end_leftovers(path: &Path, grace: Duration) {
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    let mut groups = Vec::new();
    for line in text.lines() {
        let Some((pgid, started)) = line.split_once(' ') else {
            continue;
        };
        let Ok(pgid) = pgid.parse::<i32>() else {
            continue;
        };
        if pgid <= 1 {
            continue;
        }
        let ours = match start_time(pgid) {
            Some(now) => !started.is_empty() && now == started,
            None => alive(pgid),
        };
        if ours {
            tracing::warn!("ending engine processes left from an earlier run ({pgid})");
            signal(pgid, libc::SIGTERM);
            groups.push(pgid);
        }
    }
    for g in wait_gone(&groups, grace) {
        signal(g, libc::SIGKILL);
    }
    let _ = std::fs::remove_file(path);
}

/// When the process started, as the system tells it; `None` when there's no such
/// process. Linux: ticks since boot from `/proc/<pid>/stat`; elsewhere `ps -o lstart=`.
pub fn start_time(pid: i32) -> Option<String> {
    if cfg!(target_os = "linux") {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        // The fields after the name; starttime is field 22, the 20th of these.
        let rest = &stat[stat.rfind(')')? + 1..];
        return rest.split_whitespace().nth(19).map(str::to_owned);
    }
    let out = std::process::Command::new("ps")
        .args(["-o", "lstart=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !text.is_empty()).then_some(text)
}

/// Waits until no process is left in these groups, or `grace` is over. Returns the
/// groups still alive.
fn wait_gone(groups: &[i32], grace: Duration) -> Vec<i32> {
    let until = Instant::now() + grace;
    loop {
        let left: Vec<i32> = groups.iter().copied().filter(|&g| alive(g)).collect();
        if left.is_empty() || Instant::now() >= until {
            return left;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn alive(pgid: i32) -> bool {
    // SAFETY: signal 0 to a group only checks that it has members.
    unsafe { libc::kill(-pgid, 0) == 0 }
}

fn signal(pgid: i32, sig: i32) {
    if pgid > 1 {
        // SAFETY: kill(2) on a group we started.
        unsafe {
            libc::kill(-pgid, sig);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pid_alive(pid: i32) -> bool {
        // A zombie still answers kill(0); /proc tells them apart on Linux.
        let state = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
        // SAFETY: signal 0 only checks.
        let exists = unsafe { libc::kill(pid, 0) == 0 };
        exists && !state.split(") ").nth(1).is_some_and(|s| s.starts_with('Z'))
    }

    #[tokio::test]
    async fn leftovers_are_ended_only_when_they_are_still_ours() {
        let dir = tempfile::tempdir().unwrap();
        let record = dir.path().join("engines-live");
        let mut cmd = std::process::Command::new("sleep");
        cmd.arg("4243");
        std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
        let mut child = cmd.spawn().unwrap();
        let pid = child.id() as i32;
        let started = start_time(pid).unwrap();
        // A start time that doesn't match: the pid now belongs to someone else.
        std::fs::write(&record, format!("{pid} not-{started}\n")).unwrap();
        end_leftovers(&record, Duration::from_millis(100));
        assert!(child.try_wait().unwrap().is_none());
        std::fs::write(&record, format!("{pid} {started}\n")).unwrap();
        end_leftovers(&record, Duration::from_secs(3));
        let status = child.wait().unwrap();
        assert!(!status.success());
        assert!(!record.exists());
    }

    #[tokio::test]
    async fn dropping_the_group_ends_grandchildren() {
        let dir = tempfile::tempdir().unwrap();
        let pidfile = dir.path().join("pid");
        let mut cmd = tokio::process::Command::new("sh");
        cmd.arg("-c")
            .arg(format!(
                "sleep 4242 & echo $! > {}; wait",
                pidfile.display()
            ))
            .kill_on_drop(true);
        configure(&mut cmd);
        let child = cmd.spawn().unwrap();
        let group = Group::new(child.id().unwrap());
        let mut grandchild = 0;
        for _ in 0..100 {
            if let Some(pid) = std::fs::read_to_string(&pidfile)
                .ok()
                .and_then(|s| s.trim().parse::<i32>().ok())
            {
                grandchild = pid;
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(grandchild > 0 && pid_alive(grandchild));
        drop(group);
        drop(child);
        for _ in 0..100 {
            if !pid_alive(grandchild) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("the grandchild {grandchild} outlived its group");
    }
}
