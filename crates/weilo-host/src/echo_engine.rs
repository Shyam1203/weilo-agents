//! `weilo engine echo`: an ACP agent for tests and demos. It needs no key and no network.
//!
//! It answers "You said: …" (to the last block of the prompt) in small pieces, shows one
//! step, and asks before running a fake command when the message contains "approve".
//! Other words in the message, for tests:
//! - "slow": takes about 3 s, so Stop can be tried; "stubborn": ignores Stop.
//! - "hang": says nothing until stopped.
//! - "login": answers like an engine that isn't signed in.
//! - "who are you": repeats the instructions it was given at the start of the session.
//! - "helper": starts a background `sleep` and says its pid.
//! - "check the key": says "Key is set." when `WEILO_ECHO_KEY` is set, else fails the
//!   turn as ACP `auth_required`, like an engine without a working key.
//! - "say nothing": sends pi-acp's startup notes, then ends the turn without a word. With
//!   `WEILO_ECHO_KEY` set to "bad" it first logs a provider's 401, as pi does.
//!
//! It can load a session it started before (its instructions are kept in
//! `WEILO_ECHO_STATE`), unless `WEILO_ECHO_NO_LOAD` is set.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent_client_protocol::schema::v1::{
    AgentCapabilities, CancelNotification, ContentBlock, ContentChunk, InitializeRequest,
    InitializeResponse, LoadSessionRequest, LoadSessionResponse, NewSessionRequest,
    NewSessionResponse, PermissionOption, PermissionOptionKind, PromptRequest, PromptResponse,
    RequestPermissionOutcome, RequestPermissionRequest, SessionId, SessionNotification,
    SessionUpdate, StopReason, ToolCall, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields,
    ToolKind,
};
use agent_client_protocol::{
    Agent, ByteStreams, Client, ConnectionTo, on_receive_notification, on_receive_request,
};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
use tokio_util::sync::CancellationToken;

type Cancels = Arc<Mutex<HashMap<String, CancellationToken>>>;

pub async fn run() -> anyhow::Result<()> {
    let cancels: Cancels = Arc::default();
    let on_prompt = cancels.clone();
    let on_cancel = cancels;
    let transport = ByteStreams::new(
        tokio::io::stdout().compat_write(),
        tokio::io::stdin().compat(),
    );
    Agent
        .builder()
        .name("echo")
        .on_receive_request(
            async |req: InitializeRequest, responder, _cx| {
                let loads = std::env::var_os("WEILO_ECHO_NO_LOAD").is_none();
                let caps = AgentCapabilities::new().load_session(loads);
                responder
                    .respond(InitializeResponse::new(req.protocol_version).agent_capabilities(caps))
            },
            on_receive_request!(),
        )
        .on_receive_request(
            async |req: LoadSessionRequest, responder, cx: ConnectionTo<Client>| {
                // Replays the history, as real engines do; the host ignores it.
                say(&cx, &req.session_id, "(earlier messages)".into())?;
                responder.respond(LoadSessionResponse::new())
            },
            on_receive_request!(),
        )
        .on_receive_request(
            async |_req: NewSessionRequest, responder, _cx| {
                responder.respond(NewSessionResponse::new(uuid::Uuid::now_v7().to_string()))
            },
            on_receive_request!(),
        )
        .on_receive_request(
            async move |req: PromptRequest, responder, cx: ConnectionTo<Client>| {
                let token = CancellationToken::new();
                on_prompt
                    .lock()
                    .expect("cancels lock")
                    .insert(req.session_id.0.to_string(), token.clone());
                let conn = cx.clone();
                cx.spawn(async move {
                    // An error ends this turn, not the connection.
                    match answer(&conn, &req, &token).await {
                        Ok(reason) => responder.respond(PromptResponse::new(reason)),
                        Err(e) => responder.respond_with_error(e),
                    }
                })?;
                Ok(())
            },
            on_receive_request!(),
        )
        .on_receive_notification(
            async move |n: CancelNotification, _cx| {
                if let Some(token) = on_cancel
                    .lock()
                    .expect("cancels lock")
                    .get(n.session_id.0.as_ref())
                {
                    token.cancel();
                }
                Ok(())
            },
            on_receive_notification!(),
        )
        .connect_to(transport)
        .await?;
    Ok(())
}

async fn answer(
    cx: &ConnectionTo<Client>,
    req: &PromptRequest,
    cancel: &CancellationToken,
) -> agent_client_protocol::Result<StopReason> {
    let sid = req.session_id.clone();
    let mut blocks = prompt_blocks(req);
    let text = blocks.pop().unwrap_or_default();
    if !blocks.is_empty() {
        remember(&sid, &blocks.join("\n\n"));
    }
    let slow = text.contains("slow");
    let never = CancellationToken::new();
    let cancel = if text.contains("stubborn") {
        &never
    } else {
        cancel
    };
    if text.contains("hang") {
        cancel.cancelled().await;
        return Ok(StopReason::Cancelled);
    }
    if text.contains("login") {
        say(cx, &sid, "Invalid API key · Please run /login".into())?;
        return Ok(StopReason::EndTurn);
    }
    if text.contains("who are you") {
        let told = recall(&sid).unwrap_or_else(|| "nothing".into());
        say(cx, &sid, format!("I was told: {told}"))?;
        return Ok(StopReason::EndTurn);
    }
    if text.contains("check the key") {
        if std::env::var_os("WEILO_ECHO_KEY").is_none() {
            return Err(agent_client_protocol::Error::auth_required());
        }
        say(cx, &sid, "Key is set.".into())?;
        return Ok(StopReason::EndTurn);
    }
    if text.contains("say nothing") {
        say(cx, &sid, "pi v1.4.0\n---\n".into())?;
        if std::env::var("WEILO_ECHO_KEY").is_ok_and(|k| k == "bad") {
            eprintln!(
                "Error: 401 {{\"type\":\"authentication_error\",\"message\":\"invalid x-api-key\"}}"
            );
        }
        return Ok(StopReason::EndTurn);
    }
    if text.contains("helper") {
        let out = std::process::Command::new("sh")
            .args(["-c", "sleep 4242 >/dev/null 2>&1 & echo $!"])
            .output()
            .map_err(|e| agent_client_protocol::Error::internal_error().data(e.to_string()))?;
        let pid = String::from_utf8_lossy(&out.stdout).trim().to_string();
        say(cx, &sid, format!("Helper {pid}."))?;
        return Ok(StopReason::EndTurn);
    }

    let read = ToolCall::new("read-1", "Read the request")
        .kind(ToolKind::Read)
        .status(ToolCallStatus::InProgress);
    update(cx, &sid, SessionUpdate::ToolCall(read))?;
    if !pause(cancel, 30).await {
        return Ok(StopReason::Cancelled);
    }
    let done = ToolCallUpdateFields::new().status(ToolCallStatus::Completed);
    update(
        cx,
        &sid,
        SessionUpdate::ToolCallUpdate(ToolCallUpdate::new("read-1", done)),
    )?;

    let reply = format!("You said: {text}");
    let (pieces, delay) = if slow { (30, 100) } else { (4, 40) };
    for piece in split(&reply, pieces) {
        say(cx, &sid, piece)?;
        if !pause(cancel, delay).await {
            return Ok(StopReason::Cancelled);
        }
    }

    if text.contains("approve") {
        let picked = ask_to_run_checks(cx, &sid).await?;
        let allowed = picked.is_some();
        if cancel.is_cancelled() {
            return Ok(StopReason::Cancelled);
        }
        let status = if allowed {
            ToolCallStatus::Completed
        } else {
            ToolCallStatus::Failed
        };
        let fields = ToolCallUpdateFields::new().status(status);
        update(
            cx,
            &sid,
            SessionUpdate::ToolCallUpdate(ToolCallUpdate::new("run-1", fields)),
        )?;
        // An engine told "always" stops asking; Weilo keeps that rule itself.
        let said = match picked.as_deref() {
            Some("always") => "Always allowed.",
            Some(_) => "Allowed.",
            None => "Not allowed.",
        };
        say(cx, &sid, said.into())?;
    }
    Ok(StopReason::EndTurn)
}

async fn ask_to_run_checks(
    cx: &ConnectionTo<Client>,
    sid: &SessionId,
) -> agent_client_protocol::Result<Option<String>> {
    let input = serde_json::json!({ "command": "npm test -- checkout" });
    let call = ToolCall::new("run-1", "Run the shop's checks")
        .kind(ToolKind::Execute)
        .status(ToolCallStatus::Pending)
        .raw_input(input.clone());
    update(cx, sid, SessionUpdate::ToolCall(call))?;
    let fields = ToolCallUpdateFields::new()
        .title("Run the shop's checks".to_string())
        .kind(ToolKind::Execute)
        .raw_input(input);
    let options = vec![
        PermissionOption::new("allow", "Allow", PermissionOptionKind::AllowOnce),
        PermissionOption::new("always", "Always allow", PermissionOptionKind::AllowAlways),
        PermissionOption::new("reject", "Not now", PermissionOptionKind::RejectOnce),
    ];
    let request =
        RequestPermissionRequest::new(sid.clone(), ToolCallUpdate::new("run-1", fields), options);
    let response = cx.send_request(request).block_task().await?;
    Ok(match response.outcome {
        RequestPermissionOutcome::Selected(s)
            if s.option_id.0.starts_with("allow") || s.option_id.0.as_ref() == "always" =>
        {
            Some(s.option_id.0.to_string())
        }
        _ => None,
    })
}

fn prompt_blocks(req: &PromptRequest) -> Vec<String> {
    req.prompt
        .iter()
        .filter_map(|b| match b {
            ContentBlock::Text(t) => Some(t.text.clone()),
            _ => None,
        })
        .collect()
}

fn told_file(sid: &SessionId) -> Option<std::path::PathBuf> {
    let dir = std::env::var_os("WEILO_ECHO_STATE")?;
    let name: String = sid
        .0
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    Some(std::path::Path::new(&dir).join(format!("{name}.told")))
}

fn remember(sid: &SessionId, told: &str) {
    if let Some(path) = told_file(sid) {
        let _ = std::fs::create_dir_all(path.parent().unwrap_or(&path));
        let _ = std::fs::write(path, told);
    }
}

fn recall(sid: &SessionId) -> Option<String> {
    std::fs::read_to_string(told_file(sid)?).ok()
}

fn update(
    cx: &ConnectionTo<Client>,
    sid: &SessionId,
    update: SessionUpdate,
) -> agent_client_protocol::Result<()> {
    cx.send_notification(SessionNotification::new(sid.clone(), update))
}

fn say(
    cx: &ConnectionTo<Client>,
    sid: &SessionId,
    text: String,
) -> agent_client_protocol::Result<()> {
    update(
        cx,
        sid,
        SessionUpdate::AgentMessageChunk(ContentChunk::new(text.into())),
    )
}

/// Waits `ms`; false when cancelled first.
async fn pause(cancel: &CancellationToken, ms: u64) -> bool {
    tokio::select! {
        _ = cancel.cancelled() => false,
        _ = tokio::time::sleep(Duration::from_millis(ms)) => true,
    }
}

/// Splits into about `n` pieces on character boundaries (at least one).
fn split(text: &str, n: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let size = chars.len().div_ceil(n.max(1)).max(1);
    chars.chunks(size).map(|c| c.iter().collect()).collect()
}

#[cfg(test)]
mod tests {
    use super::split;

    #[test]
    fn splits_into_pieces_that_join_back() {
        let pieces = split("You said: hello there", 4);
        assert!(pieces.len() >= 3);
        assert_eq!(pieces.concat(), "You said: hello there");
        assert_eq!(split("é", 4), vec!["é"]);
    }
}
