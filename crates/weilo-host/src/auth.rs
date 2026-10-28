//! Pairing codes and device tokens.
//!
//! `weilo pair` mints a one-time code through the admin socket. A browser trades it at
//! `POST /api/pair` for a device token, kept in an HttpOnly cookie. Only the token's
//! SHA-256 is stored.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use rand::Rng;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::ids::new_id;

pub const COOKIE: &str = "weilo_device";
const CODE_TTL: Duration = Duration::from_secs(600);
/// No 0/O or 1/I, so codes read aloud cleanly.
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

#[derive(Default)]
pub struct Pairing {
    codes: Mutex<Vec<(String, Instant)>>,
    /// Held during the delay after a wrong code, so guesses go one at a time.
    pub wrong_code_gate: tokio::sync::Mutex<()>,
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
        code
    }

    /// Uses up the code if it's valid.
    pub fn redeem(&self, typed: &str) -> bool {
        let typed = normalize(typed);
        let mut codes = self.codes.lock().expect("pairing lock");
        codes.retain(|(_, at)| at.elapsed() < CODE_TTL);
        let before = codes.len();
        codes.retain(|(code, _)| !constant_time_eq(code.as_bytes(), typed.as_bytes()));
        codes.len() < before
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

/// The paired device whose cookie came with this request, if any.
pub async fn device_for_request(
    pool: &PgPool,
    headers: &axum::http::HeaderMap,
) -> sqlx::Result<Option<Uuid>> {
    let token = headers
        .get(axum::http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|c| cookie_value(c, COOKIE));
    match token {
        Some(t) => device_for_token(pool, t).await,
        None => Ok(None),
    }
}

/// Reads one cookie from a `Cookie` header.
pub fn cookie_value<'a>(header: &'a str, name: &str) -> Option<&'a str> {
    header.split(';').find_map(|part| {
        let (k, v) = part.trim().split_once('=')?;
        (k == name).then_some(v)
    })
}

pub fn set_cookie(token: &str) -> String {
    format!("{COOKIE}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_one_time_and_forgiving_about_case() {
        let p = Pairing::default();
        let code = p.mint();
        assert_eq!(code.len(), 8);
        assert!(!p.redeem("WRONG123"));
        assert!(p.redeem(&format!("{}-{}", &code[..4], &code[4..]).to_lowercase()));
        assert!(!p.redeem(&code));
    }

    #[test]
    fn finds_the_cookie() {
        assert_eq!(
            cookie_value("a=1; weilo_device=abc; b=2", COOKIE),
            Some("abc")
        );
        assert_eq!(cookie_value("a=1", COOKIE), None);
    }
}
