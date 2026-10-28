//! `weilo up`: start Postgres, the engines' runners, the job worker and the server.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use serde_json::json;

use crate::app::{App, AppParts, Settings};
use crate::engines::Registry;
use crate::home::{Home, write_private};
use crate::pg::Postgres;
use crate::{admin, db, http, jobs};

pub struct UpOptions {
    pub home: Option<PathBuf>,
    pub port: u16,
    pub web: Option<PathBuf>,
}

pub async fn run(opts: UpOptions) -> Result<()> {
    let home = Home::resolve(opts.home)?;
    if admin::is_running(&home.admin_socket()).await {
        bail!("Weilo is already running for {}.", home.root().display());
    }
    let mut pg = Postgres::start(&home).await?;
    let result = serve(&home, &pg, opts.port, opts.web).await;
    pg.stop().await;
    result
}

async fn serve(home: &Home, pg: &Postgres, port: u16, web: Option<PathBuf>) -> Result<()> {
    let db = db::open(pg).await?;
    let app = App::new(AppParts {
        home: home.clone(),
        db: db.pool.clone(),
        fence: db.fence,
        space_id: db.space_id,
        engines: Registry::load(home),
        settings: Settings::from_env(),
    });
    let setup = db::get_setting(&app.db, "setup").await?.unwrap_or_default();
    if setup["keep_awake"].as_bool() == Some(true) {
        app.keep_awake.start();
    }
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port)))
        .await
        .with_context(|| format!("port {port} is in use"))?;
    let port = listener.local_addr()?.port();
    app.set_port(port);
    let admin = admin::listen(app.clone())?;
    let worker = jobs::spawn_worker(app.clone());
    let info = json!({ "port": port, "pid": std::process::id() });
    write_private(&home.host_file(), info.to_string().as_bytes())?;

    let web = http::find_web_dir(web);
    if web.is_none() {
        tracing::warn!("the web app isn't built; serving a placeholder page");
    }
    println!("Weilo is running at http://127.0.0.1:{port}");
    println!("To connect a browser, run: weilo pair");

    let router = http::router(app.clone(), web);
    let stopping = app.shutdown.clone();
    let server = axum::serve(listener, router).with_graceful_shutdown(async move {
        stop_signal().await;
        stopping.cancel();
    });
    let served = server.await;

    tracing::info!("stopping");
    app.shutdown.cancel();
    app.runners.shutdown();
    app.keep_awake.stop();
    admin.abort();
    worker.abort();
    let _ = std::fs::remove_file(home.admin_socket());
    let _ = std::fs::remove_file(home.host_file());
    // Give runners a moment to drop their engine processes.
    tokio::time::sleep(Duration::from_millis(200)).await;
    tokio::time::timeout(Duration::from_secs(5), app.db.close())
        .await
        .ok();
    drop(Arc::try_unwrap(app).ok());
    served.context("server failed")
}

async fn stop_signal() {
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("SIGTERM handler");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
}
