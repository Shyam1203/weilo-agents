//! Pairing codes and device tokens.
//!
//! `weilo pair` mints a one-time code through the admin socket. A browser trades it at
//! `POST /api/pair` for a device token, which the app keeps in its own storage (scoped
//! to this origin, port included) and sends in the socket's `hello` and as
//! `Authorization: Bearer` on HTTP. Only the token's SHA-256 is stored.
//!
//! Cookies on 127.0.0.1 are shared with every other port, so the token is never one.
//! The pair answer also sets a short-lived, one-time handoff cookie (path `/api/token`
//! only) that the app trades for the token at `POST /api/token` once, so a pairing
//! page that doesn't read the answer's body still works. The old `weilo_device`
//! cookie is traded the same way, once, and cleared.
//!
//! Wrong codes are answered one at a time, a second each; after 10 in a row pairing
//! is locked for 10 minutes, or until `weilo pair` makes a new code.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use rand::Rng;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::ids::new_id;

/// The cookie older versions kept the token in. Only traded for the token now.
pub const LEGACY_COOKIE: &str = "weilo_device";
pub const HANDOFF_COOKIE: &str = "weilo_handoff";
const HANDOFF_TTL: Duration = Duration::from_secs(300);
const CODE_TTL: Duration = Duration::from_secs(600);
pub const MAX_WRONG_CODES: u32 = 10;
pub const LOCKED_FOR: Duration = Duration::from_secs(600);
/// No 0/O or 1/I, so codes read aloud cleanly.
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

#[derive(Default)]
pub struct Pairing {
    codes: Mutex<Vec<(String, Instant)>>,
    /// Taken before a code is checked and held through the delay after a wrong one,
    /// so guesses go strictly one at a time.
    pub gate: tokio::sync::Mutex<()>,
    wrong: Mutex<Wrong>,
    /// One-time handoff secrets (hashed) and the token each one gives.
    handoffs: Mutex<Vec<(Vec<u8>, String, Instant)>>,
}

#[derive(Default)]
struct Wrong {
    count: u32,
    locked_until: Option<Instant>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Redeem {
    Ok,
    Wrong,
    /// Too many wrong codes; try again after this long.
    Locked(Duration),
}

impl Pairing {
    pub fn mint(&self) -> String {
        let mut rng = rand::rng();
        let code: String = (0..8)
            .map(|_| CODE_ALPHABET[rng.random_range(0..CODE_ALPHABET.len())] as char)
            .collect();
        let mut codes = self.codes.lock().expect("pairing lock");
        codes.retain(|(_, at)| at.elapsed() < CODE_TTL);
        codes.push((code.clone(), Instant::now()));
        // Someone at this computer asked for a code: that lifts a lock.
        *self.wrong.lock().expect("pairing lock") = Wrong::default();
        code
    }

    /// Uses up the code if it's valid. Call with `gate` held.
    pub fn redeem(&self, typed: &str) -> Redeem {
        let mut wrong = self.wrong.lock().expect("pairing lock");
        if let Some(until) = wrong.locked_until {
            let left = until.saturating_duration_since(Instant::now());
            if !left.is_zero() {
                return Redeem::Locked(left);
            }
            *wrong = Wrong::default();
        }
        let typed = normalize(typed);
        let mut codes = self.codes.lock().expect("pairing lock");
        codes.retain(|(_, at)| at.elapsed() < CODE_TTL);
        let before = codes.len();
        codes.retain(|(code, _)| !constant_time_eq(code.as_bytes(), typed.as_bytes()));
        if codes.len() < before {
            *wrong = Wrong::default();
            return Redeem::Ok;
        }
        wrong.count += 1;
        if wrong.count >= MAX_WRONG_CODES {
            wrong.locked_until = Some(Instant::now() + LOCKED_FOR);
        }
        Redeem::Wrong
    }

    /// A one-time secret that `claim` trades for `token` within a few minutes.
    pub fn hand_off(&self, token: &str) -> String {
        let secret = new_token();
        let mut list = self.handoffs.lock().expect("pairing lock");
        list.retain(|(_, _, at)| at.elapsed() < HANDOFF_TTL);
        list.push((token_hash(&secret), token.to_string(), Instant::now()));
        secret
    }

    pub fn claim(&self, secret: &str) -> Option<String> {
        let hash = token_hash(secret);
        let mut list = self.handoffs.lock().expect("pairing lock");
        list.retain(|(_, _, at)| at.elapsed() < HANDOFF_TTL);
        let i = list
            .iter()
            .position(|(h, _, _)| constant_time_eq(h, &hash))?;
        Some(list.remove(i).1)
    }
}

fn normalize(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn new_token() -> String {
    let bytes: [u8; 32] = rand::rng().random();
    hex::encode(bytes)
}

pub fn token_hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

/// Creates the device row and returns its id and token.
pub async fn create_device(
    pool: &PgPool,
    space_id: Uuid,
    name: &str,
) -> sqlx::Result<(Uuid, String)> {
    let id = new_id();
    let token = new_token();
    sqlx::query("INSERT INTO devices (id, space_id, name, token_hash) VALUES ($1, $2, $3, $4)")
        .bind(id)
        .bind(space_id)
        .bind(name)
        .bind(token_hash(&token))
        .execute(pool)
        .await?;
    Ok((id, token))
}

/// The paired, unrevoked device this token belongs to.
pub async fn device_for_token(pool: &PgPool, token: &str) -> sqlx::Result<Option<Uuid>> {
    sqlx::query_scalar(
        "UPDATE devices SET last_seen_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id",
    )
    .bind(token_hash(token))
    .fetch_optional(pool)
    .await
}

/// The paired device whose token came with this request (`Authorization: Bearer`).
pub async fn device_for_request(
    pool: &PgPool,
    headers: &axum::http::HeaderMap,
) -> sqlx::Result<Option<Uuid>> {
    match bearer(headers) {
        Some(t) => device_for_token(pool, t).await,
        None => Ok(None),
    }
}

pub fn bearer(headers: &axum::http::HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|t| !t.is_empty())
}

/// A cookie from the request's `Cookie` header.
pub fn request_cookie<'a>(headers: &'a axum::http::HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get_all(axum::http::header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find_map(|c| cookie_value(c, name))
}

/// Reads one cookie from a `Cookie` header.
pub fn cookie_value<'a>(header: &'a str, name: &str) -> Option<&'a str> {
    header.split(';').find_map(|part| {
        let (k, v) = part.trim().split_once('=')?;
        (k == name).then_some(v)
    })
}

/// The handoff cookie: only sent to `/api/token`, gone in five minutes.
pub fn handoff_cookie(secret: &str) -> String {
    format!(
        "{HANDOFF_COOKIE}={secret}; HttpOnly; SameSite=Strict; Path=/api/token; Max-Age={}",
        HANDOFF_TTL.as_secs()
    )
}

/// Headers that delete the handoff cookie and the old device cookie.
pub fn clear_cookies() -> [String; 2] {
    [
        format!("{HANDOFF_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/token; Max-Age=0"),
        format!("{LEGACY_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_one_time_and_forgiving_about_case() {
        let p = Pairing::default();
        let code = p.mint();
        assert_eq!(code.len(), 8);
        assert_eq!(p.redeem("WRONG123"), Redeem::Wrong);
        assert_eq!(
            p.redeem(&format!("{}-{}", &code[..4], &code[4..]).to_lowercase()),
            Redeem::Ok
        );
        assert_eq!(p.redeem(&code), Redeem::Wrong);
    }

    #[test]
    fn too_many_wrong_codes_lock_pairing_until_a_new_code() {
        let p = Pairing::default();
        let code = p.mint();
        for _ in 0..MAX_WRONG_CODES {
            assert_eq!(p.redeem("WRONG123"), Redeem::Wrong);
        }
        assert!(matches!(p.redeem(&code), Redeem::Locked(_)));
        let code = p.mint();
        assert_eq!(p.redeem(&code), Redeem::Ok);
    }

    #[test]
    fn handoffs_work_once() {
        let p = Pairing::default();
        let secret = p.hand_off("tok");
        assert_eq!(p.claim("nope"), None);
        assert_eq!(p.claim(&secret).as_deref(), Some("tok"));
        assert_eq!(p.claim(&secret), None);
    }

    #[test]
    fn finds_the_cookie_and_the_bearer() {
        assert_eq!(
            cookie_value("a=1; weilo_device=abc; b=2", LEGACY_COOKIE),
            Some("abc")
        );
        assert_eq!(cookie_value("a=1", LEGACY_COOKIE), None);
        let mut h = axum::http::HeaderMap::new();
        h.insert("authorization", "Bearer abc".parse().unwrap());
        assert_eq!(bearer(&h), Some("abc"));
    }
}
