//! The app's server: `/api` (health, pairing, the socket) and the web app's files.
//!
//! Every `/api` request must name this computer in `Host` (127.0.0.1 or localhost at our
//! port) and must not come from another site (`Origin`, `Sec-Fetch-Site`). That blocks
//! DNS rebinding and cross-site sockets.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;

use crate::app::App;
use crate::{audit, auth, ws};

const CSP: &str =
    "default-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";

pub fn router(app: Arc<App>, web: Option<PathBuf>) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .route("/pair", post(pair))
        .route("/token", post(token))
        .route("/ws", get(ws::upgrade))
        .fallback(|| async { (StatusCode::NOT_FOUND, "Not found.") })
        .layer(middleware::from_fn_with_state(app.clone(), guard))
        .with_state(app);
    Router::new()
        .nest("/api", api)
        .merge(web_app(web))
        .layer(SetResponseHeaderLayer::overriding(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(CSP),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        ))
}

/// The built web app, with unknown paths (the app's own routes, like `/s/<id>`) served
/// `index.html` with 200. Files under `/assets` have hashed names, so they are cached
/// for good; a missing asset is a real 404.
fn web_app(dir: Option<PathBuf>) -> Router {
    let Some(dir) = dir.filter(|d| d.join("index.html").is_file()) else {
        return Router::new().fallback(|| async {
            Html("<!doctype html><title>Weilo</title><p>The app isn't built yet. Run <code>npm run build</code> in apps/web.</p>")
        });
    };
    let assets = Router::new()
        .fallback_service(ServeDir::new(dir.join("assets")))
        .layer(SetResponseHeaderLayer::overriding(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        ));
    let pages = ServeDir::new(&dir).fallback(ServeFile::new(dir.join("index.html")));
    Router::new()
        .nest("/assets", assets)
        .fallback_service(pages)
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache"),
        ))
}

/// `--web`, `WEILO_WEB`, then `web/` beside the binary, then `apps/web/dist` in the repo.
pub fn find_web_dir(arg: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(dir) = arg.or_else(|| std::env::var_os("WEILO_WEB").map(PathBuf::from)) {
        return Some(dir);
    }
    // Resolved, so a symlink in ~/.local/bin finds the web/ beside the real binary.
    let exe = std::env::current_exe().and_then(std::fs::canonicalize).ok();
    let beside = exe.as_deref().and_then(Path::parent).map(|d| d.join("web"));
    let in_repo = exe
        .as_deref()
        .into_iter()
        .flat_map(Path::ancestors)
        .map(|a| a.join("apps/web/dist"))
        .find(|d| d.is_dir());
    let built_from = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/web/dist");
    [beside, in_repo, Some(built_from)]
        .into_iter()
        .flatten()
        .find(|d| d.is_dir())
}

async fn guard(State(app): State<Arc<App>>, req: Request, next: Next) -> Response {
    match check_request(req.headers(), app.port()) {
        Ok(()) => next.run(req).await,
        Err(why) => (StatusCode::FORBIDDEN, why).into_response(),
    }
}

/// Why a request may not use the API, if it may not.
pub fn check_request(headers: &HeaderMap, port: u16) -> Result<(), &'static str> {
    let text = |name: HeaderName| headers.get(name).and_then(|v| v.to_str().ok());
    let host = text(header::HOST).ok_or("Missing Host.")?;
    if !is_local_host(host, port) {
        return Err("Wrong Host.");
    }
    if let Some(origin) = text(header::ORIGIN)
        && origin != format!("http://{host}")
    {
        return Err("Requests from other sites aren't allowed.");
    }
    if text(HeaderName::from_static("sec-fetch-site")) == Some("cross-site") {
        return Err("Requests from other sites aren't allowed.");
    }
    Ok(())
}

fn is_local_host(host: &str, port: u16) -> bool {
    let (name, host_port) = match host.rsplit_once(':') {
        Some((n, p)) if !n.is_empty() && !p.contains(']') => (n, Some(p)),
        _ => (host, None),
    };
    let name_ok = matches!(name, "127.0.0.1" | "localhost" | "[::1]");
    let port_ok = host_port.is_none_or(|p| p.parse() == Ok(port));
    name_ok && port_ok
}

/// Up, and whether this browser is paired (so the app can tell "unpaired" from "can't
/// reach"). A database hiccup leaves `paired` out rather than sending people to pair.
async fn health(State(app): State<Arc<App>>, headers: HeaderMap) -> Json<serde_json::Value> {
    let mut body = json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") });
    if let Ok(device) = auth::device_for_request(&app.db, &headers).await {
        body["paired"] = json!(device.is_some());
    }
    Json(body)
}

#[derive(Deserialize)]
struct PairBody {
    code: String,
    #[serde(default)]
    name: Option<String>,
}

/// Trades a pairing code for a device token: `{ device_id, token }`, in the body only.
async fn pair(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(body): Json<PairBody>,
) -> Response {
    // Every guess waits its turn, before the code is even looked at.
    let gate = app.pairing.gate.lock().await;
    match app.pairing.redeem(&body.code) {
        auth::Redeem::Ok => {}
        auth::Redeem::Wrong => {
            tokio::time::sleep(Duration::from_secs(1)).await;
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "That code didn't work." })),
            )
                .into_response();
        }
        auth::Redeem::Locked(left) => {
            let minutes = left.as_secs().div_ceil(60).max(1);
            let error = format!(
                "Too many wrong codes. Wait {minutes} minutes, or run weilo pair for a new code."
            );
            return (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({ "error": error })),
            )
                .into_response();
        }
    }
    drop(gate);
    // The app sends no name, so the device is named after its browser.
    let agent = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    let name = body
        .name
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map_or_else(|| device_name(agent), str::to_string);
    match create_device(&app, Some(&name)).await {
        Ok((device_id, token)) => {
            Json(json!({ "device_id": device_id, "token": token })).into_response()
        }
        Err(e) => {
            tracing::error!("pairing failed: {e:#}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Pairing failed. Try again." })),
            )
                .into_response()
        }
    }
}

/// Trades the device cookie older versions set for a new token, once: the old token
/// stops working and the cookie is cleared.
async fn token(State(app): State<Arc<App>>, headers: HeaderMap) -> Response {
    let token = match auth::request_cookie(&headers, auth::LEGACY_COOKIE) {
        Some(old) => match auth::replace_token(&app.db, old).await {
            Ok(token) => token,
            Err(e) => {
                tracing::error!("token: {e}");
                return (StatusCode::SERVICE_UNAVAILABLE, "Try again.").into_response();
            }
        },
        None => None,
    };
    let cleared = [(header::SET_COOKIE, auth::clear_legacy_cookie())];
    match token {
        Some(token) => (cleared, Json(json!({ "token": token }))).into_response(),
        None => (
            StatusCode::UNAUTHORIZED,
            cleared,
            Json(json!({ "error": "Pair this device first." })),
        )
            .into_response(),
    }
}

/// A plain name for a device from its browser's User-Agent: "Chrome on Mac", "Safari
/// on iPhone", "Firefox on Linux"; "Browser" when it can't tell.
pub fn device_name(agent: &str) -> String {
    let has = |s: &str| agent.contains(s);
    let browser = if has("Edg/") || has("EdgiOS") || has("EdgA/") {
        Some("Edge")
    } else if has("OPR/") || has("Opera") {
        Some("Opera")
    } else if has("Firefox/") || has("FxiOS") {
        Some("Firefox")
    } else if has("CriOS") || (has("Chrome/") && !has("Chromium/")) {
        Some("Chrome")
    } else if has("Chromium/") {
        Some("Chromium")
    } else if has("Safari/") && has("Version/") {
        Some("Safari")
    } else {
        None
    };
    let system = if has("iPhone") {
        Some("iPhone")
    } else if has("iPad") {
        Some("iPad")
    } else if has("Android") {
        Some("Android")
    } else if has("CrOS") {
        Some("Chromebook")
    } else if has("Macintosh") || has("Mac OS X") {
        Some("Mac")
    } else if has("Windows") {
        Some("Windows")
    } else if has("Linux") {
        Some("Linux")
    } else {
        None
    };
    match (browser, system) {
        (Some(b), Some(s)) => format!("{b} on {s}"),
        (Some(b), None) => b.to_string(),
        (None, Some(s)) => format!("Browser on {s}"),
        (None, None) => "Browser".to_string(),
    }
}

async fn create_device(app: &App, name: Option<&str>) -> anyhow::Result<(uuid::Uuid, String)> {
    let name = name
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or("Browser");
    let (device_id, token) = auth::create_device(&app.db, app.space_id, name).await?;
    let mut tx = app.db.begin().await?;
    let detail = json!({ "device_id": device_id, "name": name });
    audit::append(
        &mut tx,
        app.space_id,
        audit::Entry {
            actor: "device",
            device_id: Some(device_id),
            action: "device.pair",
            detail,
        },
    )
    .await?;
    tx.commit().await?;
    Ok((device_id, token))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(HeaderName::from_static(k), HeaderValue::from_static(v));
        }
        h
    }

    #[test]
    fn only_local_same_site_requests_pass() {
        assert!(check_request(&headers(&[("host", "127.0.0.1:3210")]), 3210).is_ok());
        assert!(
            check_request(
                &headers(&[
                    ("host", "localhost:3210"),
                    ("origin", "http://localhost:3210")
                ]),
                3210
            )
            .is_ok()
        );
        assert!(check_request(&headers(&[("host", "evil.com:3210")]), 3210).is_err());
        assert!(check_request(&headers(&[("host", "127.0.0.1:9999")]), 3210).is_err());
        assert!(
            check_request(
                &headers(&[("host", "127.0.0.1:3210"), ("origin", "http://evil.com")]),
                3210
            )
            .is_err()
        );
        assert!(
            check_request(
                &headers(&[("host", "127.0.0.1:3210"), ("sec-fetch-site", "cross-site")]),
                3210
            )
            .is_err()
        );
        assert!(check_request(&headers(&[]), 3210).is_err());
    }

    #[test]
    fn devices_are_named_after_their_browser() {
        let cases = [
            (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Chrome on Mac",
            ),
            (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
                "Safari on iPhone",
            ),
            (
                "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
                "Firefox on Linux",
            ),
            (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
                "Edge on Windows",
            ),
            (
                "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
                "Chrome on Android",
            ),
            ("", "Browser"),
            ("curl/8.5.0", "Browser"),
        ];
        for (agent, want) in cases {
            assert_eq!(super::device_name(agent), want, "{agent}");
        }
    }
}
