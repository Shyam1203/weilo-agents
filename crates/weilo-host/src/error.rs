//! Errors a call returns: a stable code for programs and one plain line for people.

use weilo_proto::ApiError;

#[derive(Debug, Clone)]
pub struct CallError {
    pub code: &'static str,
    pub message: String,
}

impl CallError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
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
    pub fn internal() -> Self {
        Self::new("internal", "Something went wrong on your Weilo computer.")
    }

    pub fn into_api(self) -> ApiError {
        ApiError { code: self.code.into(), message: self.message }
    }
}

impl From<sqlx::Error> for CallError {
    fn from(e: sqlx::Error) -> Self {
        tracing::error!("database: {e}");
        Self::internal()
    }
}

impl From<anyhow::Error> for CallError {
    fn from(e: anyhow::Error) -> Self {
        tracing::error!("{e:#}");
        Self::internal()
    }
}

impl From<crate::events::AppendError> for CallError {
    fn from(e: crate::events::AppendError) -> Self {
        tracing::error!("append: {e}");
        Self::internal()
    }
}

pub type CallResult<T> = Result<T, CallError>;
