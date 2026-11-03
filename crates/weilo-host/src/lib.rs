//! `weilo-host`: the core of Weilo. It runs Postgres, the engines and the app's server.

pub mod admin;
pub mod app;
pub mod approvals;
pub mod audit;
pub mod auth;
pub mod calls;
pub mod db;
pub mod echo_engine;
pub mod engines;
pub mod error;
pub mod events;
pub mod home;
pub mod http;
pub mod ids;
pub mod jobs;
pub mod keep_awake;
pub mod pg;
pub mod projector;
pub mod recovery;
pub mod slug;
pub mod up;
pub mod worktree;
pub mod ws;
