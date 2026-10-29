//! The admin socket (`Home::admin_socket`, 0600, in a 0700 folder): how local commands like `weilo pair` talk
//! to the running host. Only the same OS user (or root) may connect.
//!
//! One request line, one JSON reply line: `pair` mints a pairing code, `status` gives
//! the port and pid, `audit verify` checks the audit log's chain.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

use crate::app::App;

pub fn listen(app: Arc<App>) -> Result<tokio::task::JoinHandle<()>> {
    let path = app.home.admin_socket();
    if let Some(dir) = path.parent() {
        crate::home::ensure_runtime_dir(dir)
            .with_context(|| format!("couldn't make {}", dir.display()))?;
    }
    let _ = std::fs::remove_file(&path);
    let listener = UnixListener::bind(&path).context("couldn't open the admin socket")?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    Ok(tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let app = app.clone();
            tokio::spawn(async move {
                if let Err(e) = serve(&app, stream).await {
                    tracing::warn!("admin socket: {e:#}");
                }
            });
        }
    }))
}

async fn serve(app: &App, stream: UnixStream) -> Result<()> {
    // SAFETY: geteuid has no preconditions.
    let me = unsafe { libc::geteuid() };
    let peer = stream.peer_cred()?.uid();
    if peer != me && peer != 0 {
        bail!("refused a connection from uid {peer}");
    }
    let (read, mut write) = stream.into_split();
    let mut line = String::new();
    BufReader::new(read).read_line(&mut line).await?;
    let reply = match line.trim() {
        "pair" => {
            let code = app.pairing.mint();
            let url = format!("http://127.0.0.1:{}/pair?code={code}", app.port());
            json!({ "code": code, "url": url })
        }
        "status" => json!({ "port": app.port(), "pid": std::process::id() }),
        "audit verify" => match crate::audit::verify(&app.db, app.space_id).await {
            Ok(crate::audit::Verdict::Intact { rows }) => json!({ "intact": true, "rows": rows }),
            Ok(crate::audit::Verdict::BrokenAt { seq }) => {
                json!({ "intact": false, "broken_at": seq })
            }
            Err(e) => json!({ "error": format!("couldn't read the audit log: {e}") }),
        },
        other => json!({ "error": format!("unknown request: {other}") }),
    };
    write.write_all(format!("{reply}\n").as_bytes()).await?;
    Ok(())
}

/// Sends one request to the running host.
pub async fn request(socket: &Path, what: &str) -> Result<Value> {
    let Ok(stream) = UnixStream::connect(socket).await else {
        bail!("Weilo isn't running. Start it with `weilo up`.");
    };
    let (read, mut write) = stream.into_split();
    write.write_all(format!("{what}\n").as_bytes()).await?;
    let mut line = String::new();
    BufReader::new(read).read_line(&mut line).await?;
    Ok(serde_json::from_str(&line)?)
}
