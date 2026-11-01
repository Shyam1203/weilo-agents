//! Errors a call returns: a stable code for programs and one plain line for people.

use weilo_proto::ApiError;

/// Said when a call couldn't reach the database.
pub const DATABASE_AWAY: &str = "Weilo's database isn't answering. Try again in a moment.";

#[derive(Debug, Clone)]
pub struct CallError {
    pub code: &'static str,
    pub message: String,
}

impl CallError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("not_found", message)
    }
    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new("conflict", message)
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid", message)
    }
    pub fn engine(message: impl Into<String>) -> Self {
        Self::new("engine", message)
    }
    /// Postgres runs but doesn't answer (or is restarting): worth trying again soon.
    pub fn database_away() -> Self {
        Self::new("database_away", DATABASE_AWAY)
    }
    pub fn internal() -> Self {
        Self::new("internal", "Something went wrong on your Weilo computer.")
    }

    pub fn into_api(self) -> ApiError {
        ApiError {
            code: self.code.into(),
            message: self.message,
        }
    }
}

impl From<sqlx::Error> for CallError {
    fn from(e: sqlx::Error) -> Self {
        if crate::db::unreachable_sql(&e) {
            tracing::warn!("database out of reach: {e}");
            return Self::database_away();
        }
        tracing::error!("database: {e}");
        Self::internal()
    }
}

impl From<anyhow::Error> for CallError {
    fn from(e: anyhow::Error) -> Self {
        if crate::db::unreachable(&e) {
            tracing::warn!("database out of reach: {e:#}");
            return Self::database_away();
        }
        tracing::error!("{e:#}");
        Self::internal()
    }
}

impl From<crate::events::AppendError> for CallError {
    fn from(e: crate::events::AppendError) -> Self {
        if let crate::events::AppendError::Db(sql) = &e
            && crate::db::unreachable_sql(sql)
        {
            tracing::warn!("database out of reach: {e}");
            return Self::database_away();
        }
        tracing::error!("append: {e}");
        Self::internal()
    }
}

pub type CallResult<T> = Result<T, CallError>;
