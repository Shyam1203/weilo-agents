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
