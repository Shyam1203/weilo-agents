//! `weilo engine echo`: an ACP agent for tests and demos. It needs no key and no network.
//!
//! It answers "You said: …" in small pieces, shows one step, and asks before running a
//! fake command when the message contains "approve". With "slow" it takes about 3 s, so
//! Stop can be tried.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent_client_protocol::schema::v1::{
    CancelNotification, ContentBlock, ContentChunk, InitializeRequest, InitializeResponse,
    NewSessionRequest, NewSessionResponse, PermissionOption, PermissionOptionKind, PromptRequest,
    PromptResponse, RequestPermissionOutcome, RequestPermissionRequest, SessionId,
    SessionNotification, SessionUpdate, StopReason, ToolCall, ToolCallStatus, ToolCallUpdate,
    ToolCallUpdateFields, ToolKind,
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
                responder.respond(InitializeResponse::new(req.protocol_version))
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
                    let reason = answer(&conn, &req, &token).await?;
                    responder.respond(PromptResponse::new(reason))
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
    let text = prompt_text(req);
    let slow = text.contains("slow");

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
        let allowed = ask_to_run_checks(cx, &sid).await?;
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
        say(
            cx,
            &sid,
            if allowed { "Allowed." } else { "Not allowed." }.into(),
        )?;
    }
    Ok(StopReason::EndTurn)
}

async fn ask_to_run_checks(
    cx: &ConnectionTo<Client>,
    sid: &SessionId,
) -> agent_client_protocol::Result<bool> {
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
    Ok(matches!(
        response.outcome,
        RequestPermissionOutcome::Selected(s) if s.option_id.0.starts_with("allow") || s.option_id.0.as_ref() == "always"
    ))
}

fn prompt_text(req: &PromptRequest) -> String {
    req.prompt
        .iter()
        .filter_map(|b| match b {
            ContentBlock::Text(t) => Some(t.text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(" ")
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
