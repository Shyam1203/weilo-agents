//! Engine processes run in their own process group, so stopping one also stops what it
//! started (shells, test runners, language servers). A group is ended with SIGTERM, then
//! SIGKILL after a grace period: when its runner drops it, and for every live group when
//! the host stops. On Linux the engine also gets SIGKILL if the host dies (PDEATHSIG).

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long a group has to stop after SIGTERM before it gets SIGKILL.
pub const GRACE: Duration = Duration::from_secs(3);

static LIVE: Mutex<Vec<i32>> = Mutex::new(Vec::new());

/// Puts the command in a new process group, and on Linux asks for SIGKILL when the
/// host goes away.
pub fn configure(cmd: &mut tokio::process::Command) {
    cmd.process_group(0);
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
        LIVE.lock().expect("groups lock").push(pgid);
        Self { pgid }
    }
}

impl Drop for Group {
    fn drop(&mut self) {
        LIVE.lock()
            .expect("groups lock")
            .retain(|&g| g != self.pgid);
        let pgid = self.pgid;
        signal(pgid, libc::SIGTERM);
        // Waiting would block the runner, so a small thread finishes the job.
        std::thread::spawn(move || {
            wait_gone(&[pgid], GRACE);
            signal(pgid, libc::SIGKILL);
        });
    }
}

/// Ends every live group: SIGTERM, then SIGKILL for any still there after `grace`.
pub fn kill_all(grace: Duration) {
    let groups: Vec<i32> = std::mem::take(&mut *LIVE.lock().expect("groups lock"));
    for &g in &groups {
        signal(g, libc::SIGTERM);
    }
    let left = wait_gone(&groups, grace);
    for g in left {
        signal(g, libc::SIGKILL);
    }
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
        unsafe { libc::kill(pid, 0) == 0 }
            && !state.split(") ").nth(1).is_some_and(|s| s.starts_with('Z'))
    }

    #[tokio::test]
    async fn dropping_the_group_ends_grandchildren() {
        let dir = tempfile::tempdir().unwrap();
        let pidfile = dir.path().join("pid");
        let mut cmd = tokio::process::Command::new("sh");
        cmd.arg("-c")
            .arg(format!("sleep 4242 & echo $! > {}; wait", pidfile.display()))
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
