//! `weilo up`: start Postgres, the engines' runners, the job worker and the server.
//!
//! One host per home: `up` holds an exclusive lock on `HOME/lock` while it runs, so a
//! second `up` stops before it touches Postgres.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use serde_json::json;
use tokio_util::sync::CancellationToken;

use crate::app::{App, AppParts, Settings};
use crate::engines::{Registry, process};
use crate::home::{Home, try_lock, write_private};
use crate::pg::Postgres;
use crate::{admin, db, http, jobs, recovery};

pub struct UpOptions {
    pub home: Option<PathBuf>,
    pub port: u16,
    pub web: Option<PathBuf>,
}

pub async fn run(opts: UpOptions) -> Result<()> {
    let home = Home::resolve(opts.home)?;
    home.ensure(0o700)?;
    let Some(_lock) = try_lock(&home.lock_file())? else {
        return Err(already_running(&home));
    };
    // Before anything starts: what a crashed run left running ends here.
    process::end_leftovers(&home.live_engines(), process::GRACE);
    process::record_in(home.live_engines());
    let mut pg = Postgres::start(&home).await?;
    let db = match db::open(&pg).await {
        Ok(db) => db,
        Err(e) => {
            pg.stop().await;
            return Err(e);
        }
    };
    serve(&home, pg, db, opts.port, opts.web).await
}

fn already_running(home: &Home) -> anyhow::Error {
    let port = std::fs::read(home.host_file())
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| v["port"].as_u64());
    match port {
        Some(port) => anyhow!("Weilo is already running at http://127.0.0.1:{port}"),
        None => anyhow!("Weilo is already running for {}.", home.root().display()),
    }
}

async fn serve(
    home: &Home,
    pg: Postgres,
    db: db::Db,
    port: u16,
    web: Option<PathBuf>,
) -> Result<()> {
    let app = App::new(AppParts {
        home: home.clone(),
        db: db.pool.clone(),
        fence: db.fence,
        space_id: db.space_id,
        engines: Registry::load(home),
        settings: Settings::from_env(),
    });
    // Postgres is watched from here on; turns wait while it restarts.
    let pg_stop = CancellationToken::new();
    let weak = Arc::downgrade(&app);
    let pg_task = tokio::spawn(pg.supervise(pg_stop.clone(), move |up| {
        if let Some(app) = weak.upgrade() {
            app.set_db_up(up);
        }
    }));
    let result = serve_app(home, &app, port, web).await;
    pg_stop.cancel();
    let _ = pg_task.await;
    result
}

async fn serve_app(home: &Home, app: &Arc<App>, port: u16, web: Option<PathBuf>) -> Result<()> {
    let app = app.clone();
    if let Err(e) = recovery::run(&app).await {
        tracing::warn!("couldn't tidy up after the last run: {e:#}");
    }
    if let Err(e) = jobs::schedule_prune(&app, chrono::Utc::now()).await {
        tracing::warn!("couldn't schedule the daily tidy-up: {e}");
    }
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
    admin.abort();
    worker.abort();
    let runners = app.clone();
    let _ = tokio::task::spawn_blocking(move || runners.runners.shutdown(process::GRACE)).await;
    app.keep_awake.stop();
    let _ = std::fs::remove_file(home.admin_socket());
    let _ = std::fs::remove_file(home.host_file());
    tokio::time::timeout(Duration::from_secs(5), app.db.close())
        .await
        .ok();
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
