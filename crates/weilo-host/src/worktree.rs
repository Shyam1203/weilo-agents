//! A session in a git repo works in its own worktree, beside the repo in
//! `<repo>/../.weilo-worktrees/<slug>`, on a new branch `weilo/<slug>`.

use std::path::{Path, PathBuf};

use tokio::process::Command;

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
        let args = [ident.as_slice(), &["commit", "-q", "-m", &message]].concat();
        git(worktree, &args)
            .await
            .map_err(|_| "Couldn't save the session's changes.")?;
    }
    let dirty = git(&repo, &["status", "--porcelain", "--untracked-files=no"])
        .await
        .map_err(|_| "Couldn't read the original folder.")?;
    if !dirty.is_empty() {
        return Err(
            "The original folder has unsaved changes. Commit or put them aside, then try again."
                .into(),
        );
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
        &["merge", "--no-ff", "--no-edit", &branch],
    ]
    .concat();
    if git(&repo, &args).await.is_err() {
        let _ = git(&repo, &["merge", "--abort"]).await;
        return Err(
            "These changes clash with changes in the original folder, so nothing was changed."
                .into(),
        );
    }
    let place = repo
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "the original folder".into());
    Ok(format!("Brought the session's changes into {place}."))
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

async fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
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
