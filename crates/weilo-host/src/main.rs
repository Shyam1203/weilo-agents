use std::path::PathBuf;

use clap::{Parser, Subcommand};
use weilo_host::home::Home;
use weilo_host::up::{self, UpOptions};
use weilo_host::{admin, echo_engine};

#[derive(Parser)]
#[command(
    name = "weilo",
    about = "Weilo: your agents, on your computer.",
    version
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Start Weilo on this computer.
    Up {
        /// Where Weilo keeps its data (default ~/.weilo-agents, or WEILO_HOME).
        #[arg(long)]
        home: Option<PathBuf>,
        /// Port for the app (0 picks a free one).
        #[arg(long, default_value_t = 3210)]
        port: u16,
        /// The built web app (default apps/web/dist, or WEILO_WEB).
        #[arg(long)]
        web: Option<PathBuf>,
    },
    /// Print a one-time code to connect a browser.
    Pair {
        /// Where the running Weilo keeps its data (default ~/.weilo-agents, or WEILO_HOME).
        #[arg(long)]
        home: Option<PathBuf>,
    },
    /// Check Weilo's activity record.
    Audit {
        #[command(subcommand)]
        audit: AuditCommand,
    },
    /// Run a built-in engine over stdio.
    Engine {
        #[command(subcommand)]
        engine: EngineCommand,
    },
    /// Print the version.
    Version,
}

#[derive(Subcommand)]
enum AuditCommand {
    /// Check that nothing changed the audit log outside Weilo.
    Verify {
        /// Where the running Weilo keeps its data (default ~/.weilo-agents, or WEILO_HOME).
        #[arg(long)]
        home: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
enum EngineCommand {
    /// An engine that repeats what you say. For tests; needs no key.
    Echo,
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    if let Err(e) = run(cli.command).await {
        eprintln!("{e:#}");
        std::process::exit(1);
    }
}

async fn run(command: Command) -> anyhow::Result<()> {
    match command {
        Command::Up { home, port, web } => {
            init_logs();
            up::run(UpOptions { home, port, web }).await
        }
        Command::Pair { home } => {
            let home = Home::resolve(home)?;
            let reply = admin::request(&home.admin_socket(), "pair").await?;
            let code = reply["code"].as_str().unwrap_or_default();
            println!("Your code: {code}");
            println!("Or open: {}", reply["url"].as_str().unwrap_or_default());
            println!("It works once, for 10 minutes.");
            Ok(())
        }
        Command::Audit {
            audit: AuditCommand::Verify { home },
        } => {
            let home = Home::resolve(home)?;
            let reply = admin::request(&home.admin_socket(), "audit verify").await?;
            if let Some(error) = reply["error"].as_str() {
                anyhow::bail!("{error}");
            }
            if reply["intact"].as_bool() == Some(true) {
                let rows = reply["rows"].as_i64().unwrap_or(0);
                println!("The audit log is intact ({rows} entries).");
                Ok(())
            } else {
                let seq = reply["broken_at"].as_i64().unwrap_or(0);
                anyhow::bail!("{}", weilo_host::audit::broken_line(seq))
            }
        }
        // Logs would mix with the protocol on stdout, so the engine stays quiet.
        Command::Engine {
            engine: EngineCommand::Echo,
        } => echo_engine::run().await,
        Command::Version => {
            println!("weilo {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
    }
}

fn init_logs() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "weilo_host=info,warn".into());
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(std::io::stderr)
        .init();
}
