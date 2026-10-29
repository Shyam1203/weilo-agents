//! A session in a git repo works in its own worktree, beside the repo in
//! `<repo>/../.weilo-worktrees/<slug>`, on a new branch `weilo/<slug>`.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tokio::process::Command;
use weilo_proto::{ChangedFile, FileChange, SessionChanges};

/// The longest one git command may take before it counts as failed.
const GIT_TIMEOUT: Duration = Duration::from_secs(60);

/// For Weilo's own commits: no signing prompt (gpg may want a passphrase nobody can
/// type) and no hooks.
const OWN_COMMIT: [&str; 2] = ["-c", "commit.gpgsign=false"];

#[derive(Debug, PartialEq, Eq)]
pub enum Prepared {
    /// The folder doesn't exist.
    Missing,
    /// Not a git repo: the session works in the folder itself.
    Plain,
    Worktree {
        path: PathBuf,
        branch: String,
    },
    /// A repo, but the worktree couldn't be made; the session works in the folder.
    Failed {
        reason: String,
    },
}

pub async fn prepare(folder: &Path, slug: &str) -> Prepared {
    if !folder.is_dir() {
        return Prepared::Missing;
    }
    let Some(repo) = repo_root(folder).await else {
        return Prepared::Plain;
    };
    let Some(parent) = repo.parent() else {
        return Prepared::Failed {
            reason: "the repo has no parent folder".into(),
        };
    };
    let base = parent.join(".weilo-worktrees");
    for candidate in candidates(slug) {
        if base.join(&candidate).exists() || branch_exists(&repo, &candidate).await {
            continue;
        }
        let path = base.join(&candidate);
        let branch = format!("weilo/{candidate}");
        return match add_worktree(&repo, &path, &branch).await {
            Ok(()) => Prepared::Worktree { path, branch },
            Err(reason) => Prepared::Failed { reason },
        };
    }
    Prepared::Failed {
        reason: "no free name".into(),
    }
}

fn candidates(slug: &str) -> impl Iterator<Item = String> + '_ {
    let base = if slug.is_empty() { "session" } else { slug };
    (1..=50).map(move |n| {
        if n == 1 {
            base.to_string()
        } else {
            format!("{base}-{n}")
        }
    })
}

/// The session branch of a worktree made by `prepare` (`weilo/<its folder name>`).
pub fn branch_of(worktree: &str) -> Option<String> {
    let name = Path::new(worktree).file_name()?.to_str()?;
    Some(format!("weilo/{name}"))
}

/// Brings a session's work back into the repo it came from: commits what the session
/// left uncommitted in its worktree, then merges its branch into the repo's current
/// branch. Changes nothing when the repo has unsaved changes or the merge would
/// clash. Answers with one plain line either way.
pub async fn merge_back(folder: &Path, worktree: &Path, title: &str) -> Result<String, String> {
    let branch = branch_of(&worktree.to_string_lossy()).ok_or("This session has no branch.")?;
    let repo = repo_root(folder)
        .await
        .ok_or("The original folder isn't a git repo any more.")?;
    if !worktree.is_dir() {
        return Err("This session's copy of the repo is gone.".into());
    }
    let id = identity(&repo).await;
    let ident: Vec<&str> = id.iter().map(String::as_str).collect();
    let pending = git(worktree, &["status", "--porcelain"])
        .await
        .map_err(|_| "Couldn't read the session's changes.")?;
    if !pending.is_empty() {
        git(worktree, &["add", "-A"])
            .await
            .map_err(|_| "Couldn't save the session's changes.")?;
        let message = format!("Changes from the Weilo session \"{title}\"");
        let args = [
            ident.as_slice(),
            &OWN_COMMIT,
            &["commit", "-q", "--no-verify", "-m", &message],
        ]
        .concat();
        git(worktree, &args)
            .await
            .map_err(|_| "Couldn't save the session's changes.")?;
    }
    // Untracked files only matter when the merge would write over them; git says so,
    // and that is reported below.
    let dirty = git(&repo, &["status", "--porcelain", "--untracked-files=no"])
        .await
        .map_err(|_| "Couldn't read the original folder.")?;
    let place = repo
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "the original folder".into());
    if !dirty.is_empty() {
        return Err(format!(
            "Your copy of {place} has edits that Bring back would overwrite. Save or undo them first."
        ));
    }
    let range = format!("HEAD..{branch}");
    let ahead = git(&repo, &["rev-list", "--count", &range])
        .await
        .map_err(|_| "Couldn't find the session's branch.")?;
    if ahead.trim() == "0" {
        return Ok("There's nothing new to bring back.".into());
    }
    let args = [
        ident.as_slice(),
        &OWN_COMMIT,
        &["merge", "--no-ff", "--no-edit", "--no-verify", &branch],
    ]
    .concat();
    let merged = run_git(&repo, &args, None).await?;
    if merged.ok {
        return Ok(format!("{BROUGHT_BACK} {place}."));
    }
    if let Some(files) = in_the_way(&merged.stderr) {
        // Git stopped before it changed anything; there is no merge to undo.
        let (what, them) = if files.len() == 1 {
            (format!("A file in {place} is in the way"), "it")
        } else {
            (format!("Some files in {place} are in the way"), "them")
        };
        return Err(format!(
            "{what}: {}. Move {them}, then try again.",
            files.join(", ")
        ));
    }
    let _ = git(&repo, &["merge", "--abort"]).await;
    if merged.stdout.contains("CONFLICT") {
        return Err(
            "These changes clash with changes in the original folder, so nothing was changed."
                .into(),
        );
    }
    tracing::warn!("bring back failed: {}", merged.stderr);
    Err("Couldn't bring the changes back, so nothing was changed. Try again.".into())
}

/// Files git won't write over because they aren't saved in the repo ("untracked working
/// tree files would be overwritten by merge"), as git listed them.
fn in_the_way(stderr: &str) -> Option<Vec<String>> {
    let mut lines = stderr.lines();
    lines.find(|l| l.contains("untracked working tree files would be"))?;
    let files: Vec<String> = lines
        .take_while(|l| l.starts_with('\t') || l.starts_with("    "))
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .take(5)
        .collect();
    (!files.is_empty()).then_some(files)
}

/// How a successful Bring back begins its answer.
pub const BROUGHT_BACK: &str = "Brought the session's changes into";

/// The most diff text sent; the rest is cut.
const MAX_DIFF: usize = 200 * 1024;
/// The most files listed, and looked at, outside git.
const MAX_FILES: usize = 1000;
const MAX_LOOKED_AT: usize = 20_000;

/// What a session changed. In its own copy of the repo: everything since it branched,
/// saved or not. Working in a repo itself: what isn't saved yet. In a folder that isn't
/// a repo: the files changed since `started`, without a diff.
pub async fn changes(
    folder: &Path,
    worktree: Option<&Path>,
    started: SystemTime,
) -> Result<SessionChanges, String> {
    let (dir, base) = match worktree {
        Some(w) => {
            if !w.is_dir() {
                return Err("This session's copy of the repo is gone.".into());
            }
            // Where the session's branch left the repo's current branch.
            let base = match repo_root(folder).await {
                Some(repo) => match git(&repo, &["rev-parse", "HEAD"]).await {
                    Ok(head) => git(w, &["merge-base", "HEAD", &head]).await.ok(),
                    Err(_) => None,
                },
                None => None,
            };
            (w.to_path_buf(), base.unwrap_or_else(|| "HEAD".into()))
        }
        None => match repo_root(folder).await {
            Some(_) => (folder.to_path_buf(), "HEAD".into()),
            None => return Ok(plain_changes(folder, started)),
        },
    };
    let read_err = |_| "Couldn't read the session's changes.".to_string();
    let numstat = git_raw(&dir, &["diff", "--no-renames", "--numstat", "-z", &base])
        .await
        .map_err(read_err)?;
    let names = git_raw(
        &dir,
        &["diff", "--no-renames", "--name-status", "-z", &base],
    )
    .await
    .map_err(read_err)?;
    let untracked = git_raw(&dir, &["ls-files", "--others", "--exclude-standard", "-z"])
        .await
        .map_err(read_err)?;
    // Read only as much of the diff as is sent; git is ended past that.
    let whole = run_git(&dir, &["diff", "--no-renames", &base], Some(MAX_DIFF + 1))
        .await
        .map_err(read_err)?;
    if !whole.ok {
        return Err("Couldn't read the session's changes.".into());
    }
    let diff_cut = whole.cut;
    let mut diff = whole.stdout;

    let mut counts = std::collections::HashMap::new();
    for entry in numstat.split('\0').filter(|e| !e.is_empty()) {
        let mut parts = entry.splitn(3, '\t');
        let (Some(a), Some(r), Some(path)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        counts.insert(
            path.to_string(),
            (a.parse().unwrap_or(0), r.parse().unwrap_or(0)),
        );
    }
    let mut files = Vec::new();
    let mut fields = names.split('\0').filter(|e| !e.is_empty());
    while let (Some(status), Some(path)) = (fields.next(), fields.next()) {
        let status = match status.chars().next() {
            Some('A') => FileChange::Added,
            Some('D') => FileChange::Deleted,
            _ => FileChange::Modified,
        };
        let (added, removed) = counts.get(path).copied().unwrap_or((0, 0));
        files.push(ChangedFile {
            path: path.to_string(),
            status,
            added,
            removed,
        });
    }
    // New files are read whole only while the diff has room; their lines are counted.
    let mut left_out = false;
    for path in untracked.split('\0').filter(|e| !e.is_empty()) {
        let text = std::fs::read(dir.join(path))
            .ok()
            .filter(|b| b.len() <= 8 * MAX_DIFF && !b.contains(&0))
            .map(|b| String::from_utf8_lossy(&b).into_owned());
        let added = text.as_ref().map_or(0, |t| t.lines().count());
        if let Some(text) = &text {
            if diff.len() < MAX_DIFF {
                diff.push_str(&new_file_diff(path, text));
            } else {
                left_out = true;
            }
        }
        files.push(ChangedFile {
            path: path.to_string(),
            status: FileChange::Added,
            added: u32::try_from(added).unwrap_or(u32::MAX),
            removed: 0,
        });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let truncated = cut(&mut diff, MAX_DIFF) || left_out || diff_cut;
    Ok(SessionChanges {
        files,
        diff: Some(diff),
        truncated,
    })
}

/// A git-style diff adding a whole new file.
fn new_file_diff(path: &str, text: &str) -> String {
    let lines = text.lines().count();
    let mut out = format!(
        "diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{lines} @@\n"
    );
    for line in text.lines() {
        out.push('+');
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// Cuts `text` to at most `max` bytes, at the end of a line. True when it cut.
fn cut(text: &mut String, max: usize) -> bool {
    if text.len() <= max {
        return false;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let end = text[..end].rfind('\n').map_or(end, |i| i + 1);
    text.truncate(end);
    true
}

/// Files in a plain folder changed since `started` (hidden folders and `node_modules`
/// aren't looked in).
fn plain_changes(folder: &Path, started: SystemTime) -> SessionChanges {
    let mut files = Vec::new();
    let mut looked = 0;
    let mut todo = vec![folder.to_path_buf()];
    while let Some(dir) = todo.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            looked += 1;
            if looked > MAX_LOOKED_AT || files.len() >= MAX_FILES {
                break;
            }
            let name = entry.file_name();
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.is_dir() {
                let name = name.to_string_lossy();
                if !name.starts_with('.') && name != "node_modules" {
                    todo.push(entry.path());
                }
                continue;
            }
            if !meta.modified().is_ok_and(|m| m >= started) {
                continue;
            }
            let status = if meta.created().is_ok_and(|c| c >= started) {
                FileChange::Added
            } else {
                FileChange::Modified
            };
            let path = entry.path();
            let path = path.strip_prefix(folder).unwrap_or(&path);
            files.push(ChangedFile {
                path: path.to_string_lossy().into_owned(),
                status,
                added: 0,
                removed: 0,
            });
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    SessionChanges {
        files,
        diff: None,
        truncated: false,
    }
}

/// `-c user.name/-c user.email` when the repo has no identity of its own, so a commit
/// can't fail for want of one.
async fn identity(repo: &Path) -> Vec<String> {
    if git(repo, &["config", "user.email"])
        .await
        .is_ok_and(|e| !e.is_empty())
    {
        return Vec::new();
    }
    ["-c", "user.name=Weilo", "-c", "user.email=weilo@localhost"]
        .map(String::from)
        .to_vec()
}

/// What one git command gave back.
struct GitOut {
    ok: bool,
    stdout: String,
    stderr: String,
    /// The output was longer than asked for and was cut there (git was then ended).
    cut: bool,
}

/// Runs git without a terminal to prompt on, in a process group of its own, so that on
/// `GIT_TIMEOUT` the whole group ends (hooks and helpers too), not only git. With `cap`,
/// at most that many bytes of output are read, then git is ended.
async fn run_git(dir: &Path, args: &[&str], cap: Option<usize>) -> Result<GitOut, String> {
    use tokio::io::AsyncReadExt;
    let mut child = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "core.quotepath=false"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;
    let pgid = child.id().map(|id| id as i32);
    let end_group = || {
        if let Some(pgid) = pgid {
            // SAFETY: kill(2) on the process group git leads.
            unsafe {
                libc::kill(-pgid, libc::SIGKILL);
            }
        }
    };
    let mut stdout = child.stdout.take().expect("piped");
    let mut stderr = child.stderr.take().expect("piped");
    let limit = cap.unwrap_or(usize::MAX);
    let work = async {
        // Read beside stdout, so neither pipe fills while the other is read.
        let errors = tokio::spawn(async move {
            let mut buf = Vec::new();
            let _ = (&mut stderr).take(64 * 1024).read_to_end(&mut buf).await;
            buf
        });
        let mut out = Vec::new();
        let mut chunk = vec![0u8; 64 * 1024];
        let mut cut = false;
        loop {
            let n = stdout.read(&mut chunk).await.map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            let room = limit - out.len();
            if n > room {
                out.extend_from_slice(&chunk[..room]);
                cut = true;
                break;
            }
            out.extend_from_slice(&chunk[..n]);
        }
        if cut {
            end_group();
        }
        drop(stdout);
        let status = child.wait().await.map_err(|e| e.to_string())?;
        let err = errors.await.unwrap_or_default();
        Ok::<_, String>(GitOut {
            ok: status.success() || cut,
            stdout: String::from_utf8_lossy(&out).into_owned(),
            stderr: String::from_utf8_lossy(&err).trim().to_string(),
            cut,
        })
    };
    match tokio::time::timeout(GIT_TIMEOUT, work).await {
        Ok(out) => out,
        Err(_) => {
            end_group();
            Err("git took too long".into())
        }
    }
}

/// Runs git (see `run_git`); its output, trimmed.
async fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = run_git(dir, args, None).await?;
    if out.ok {
        Ok(out.stdout.trim().to_string())
    } else {
        Err(out.stderr)
    }
}

/// Like `git`, with the output untrimmed.
async fn git_raw(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = run_git(dir, args, None).await?;
    if out.ok {
        Ok(out.stdout)
    } else {
        Err(out.stderr)
    }
}

async fn repo_root(folder: &Path) -> Option<PathBuf> {
    git(folder, &["rev-parse", "--show-toplevel"])
        .await
        .ok()
        .map(PathBuf::from)
}

async fn branch_exists(repo: &Path, slug: &str) -> bool {
    let reference = format!("refs/heads/weilo/{slug}");
    git(repo, &["rev-parse", "--verify", "--quiet", &reference])
        .await
        .is_ok()
}

async fn add_worktree(repo: &Path, path: &Path, branch: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let path = path.to_string_lossy();
    git(repo, &["worktree", "add", "-b", branch, &path])
        .await
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sh_git(dir: &Path, args: &[&str]) {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["-c", "user.email=t@t", "-c", "user.name=t"])
            .args(args)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}");
    }

    #[test]
    fn files_in_the_way_are_read_from_git() {
        let err = "error: The following untracked working tree files would be overwritten by merge:\n\tcart.txt\n\tlib/a.rs\nPlease move or remove them before you merge.\nAborting";
        assert_eq!(
            in_the_way(err),
            Some(vec!["cart.txt".to_string(), "lib/a.rs".to_string()])
        );
        assert_eq!(in_the_way("CONFLICT (content): Merge conflict in a"), None);
    }

    #[tokio::test]
    async fn long_output_is_cut_at_the_cap() {
        let dir = tempfile::tempdir().unwrap();
        sh_git(dir.path(), &["init", "-q"]);
        std::fs::write(dir.path().join("big.txt"), "line\n".repeat(100_000)).unwrap();
        sh_git(dir.path(), &["add", "big.txt"]);
        let out = run_git(dir.path(), &["diff", "--cached"], Some(1000))
            .await
            .unwrap();
        assert!(out.cut && out.ok);
        assert_eq!(out.stdout.len(), 1000);
        let whole = run_git(dir.path(), &["diff", "--cached"], None)
            .await
            .unwrap();
        assert!(!whole.cut && whole.stdout.len() > 500_000);
    }

    #[tokio::test]
    async fn a_file_in_the_way_is_named() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path().join("shop");
        std::fs::create_dir(&repo).unwrap();
        sh_git(&repo, &["init", "-q"]);
        sh_git(&repo, &["commit", "-q", "--allow-empty", "-m", "start"]);
        let Prepared::Worktree { path, .. } = prepare(&repo, "fix").await else {
            panic!("no worktree")
        };
        std::fs::write(path.join("cart.txt"), "from the session\n").unwrap();
        std::fs::write(repo.join("cart.txt"), "mine\n").unwrap();
        let err = merge_back(&repo, &path, "Fix").await.unwrap_err();
        assert_eq!(
            err,
            "A file in shop is in the way: cart.txt. Move it, then try again."
        );
        // Nothing changed; once it is moved, it works.
        assert_eq!(
            std::fs::read_to_string(repo.join("cart.txt")).unwrap(),
            "mine\n"
        );
        std::fs::remove_file(repo.join("cart.txt")).unwrap();
        let said = merge_back(&repo, &path, "Fix").await.unwrap();
        assert_eq!(said, "Brought the session's changes into shop.");
        // Once brought back, nothing is left to bring back.
        let left = changes(&repo, Some(&path), SystemTime::now())
            .await
            .unwrap();
        assert!(left.files.is_empty(), "{:?}", left.files);
        assert_eq!(left.diff.as_deref(), Some(""));
    }
}
