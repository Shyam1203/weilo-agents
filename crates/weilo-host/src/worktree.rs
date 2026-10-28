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
    if git(&repo, &args).await.is_err() {
        let _ = git(&repo, &["merge", "--abort"]).await;
        return Err(
            "These changes clash with changes in the original folder, so nothing was changed."
                .into(),
        );
    }
    Ok(format!("Brought the session's changes into {place}."))
}

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
    let mut diff = git_raw(&dir, &["diff", "--no-renames", &base])
        .await
        .map_err(read_err)?;

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
    let truncated = cut(&mut diff, MAX_DIFF) || left_out;
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

/// Runs git without a terminal to prompt on, killed after `GIT_TIMEOUT`.
async fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let run = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    let out = tokio::time::timeout(GIT_TIMEOUT, run)
        .await
        .map_err(|_| "git took too long".to_string())?
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Like `git`, with the output untrimmed.
async fn git_raw(dir: &Path, args: &[&str]) -> Result<String, String> {
    let run = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "core.quotepath=false"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    let out = tokio::time::timeout(GIT_TIMEOUT, run)
        .await
        .map_err(|_| "git took too long".to_string())?
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
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
