//! Turns an engine's permission request into a card people can answer.

use agent_client_protocol::schema::v1::{PermissionOptionKind, RequestPermissionRequest, ToolKind};
use uuid::Uuid;
use weilo_proto::{Card, CardAction, Decision, RiskClass};

/// What the host knows about a tool call from earlier updates.
#[derive(Debug, Clone, Default)]
pub struct ToolInfo {
    pub title: String,
    pub kind: Option<ToolKind>,
    pub raw_input: Option<serde_json::Value>,
}

pub fn tool_info(req: &RequestPermissionRequest, known: Option<&ToolInfo>) -> ToolInfo {
    let f = &req.tool_call.fields;
    let known = known.cloned().unwrap_or_default();
    ToolInfo {
        title: f
            .title
            .clone()
            .filter(|t| !t.is_empty())
            .unwrap_or(known.title),
        kind: f.kind.or(known.kind),
        raw_input: f.raw_input.clone().or(known.raw_input),
    }
}

/// What an "Always allow" rule matches: the tool's kind and its input, normalized (a
/// command with its whitespace collapsed, anything else as canonical JSON). Never the
/// title, which the engine words freely. `None` when there is no input to match on, so
/// no rule can be made.
pub fn rule_key(tool: &ToolInfo) -> Option<String> {
    let raw = tool.raw_input.as_ref()?;
    let kind = tool
        .kind
        .and_then(|k| serde_json::to_value(k).ok())
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_else(|| "other".into());
    let args = match raw.get("command") {
        Some(serde_json::Value::String(cmd)) => normalize(cmd),
        Some(serde_json::Value::Array(parts)) => {
            let words: Vec<String> = parts
                .iter()
                .map(|p| p.as_str().map_or_else(|| p.to_string(), str::to_owned))
                .collect();
            normalize(&words.join(" "))
        }
        _ => crate::audit::canonical_json(raw),
    };
    Some(format!("{kind}:{args}"))
}

fn normalize(cmd: &str) -> String {
    cmd.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Where an "Always allow" rule applies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlwaysScope {
    /// A coding session's folder: "Always allow in this folder".
    Folder,
    /// An agent's own chats, which have no folder of the person's: "Always allow for Ava".
    Agent,
}

/// `always` adds an "Always allow" action for that scope; the host keeps that rule itself.
pub fn permission_card(
    agent: &str,
    approval_id: Uuid,
    tool: &ToolInfo,
    always: Option<AlwaysScope>,
) -> Card {
    let title = if tool.title.is_empty() {
        "Use a tool".to_string()
    } else {
        tool.title.clone()
    };
    let (risk, risk_line) = risk(tool);
    let mut actions = vec![CardAction {
        id: "allow".into(),
        label: "Allow".into(),
        primary: true,
        decision: Some(Decision::Allow),
    }];
    if let Some(scope) = always {
        let (label, scope) = match scope {
            AlwaysScope::Folder => ("Always allow in this folder".to_string(), "folder"),
            AlwaysScope::Agent => (format!("Always allow for {agent}"), "agent"),
        };
        actions.push(CardAction {
            id: "always".into(),
            label,
            primary: false,
            decision: Some(Decision::AllowAlways {
                scope: scope.into(),
            }),
        });
    }
    actions.push(CardAction {
        id: "deny".into(),
        label: "Not now".into(),
        primary: false,
        decision: Some(Decision::Deny),
    });
    Card {
        kind: "approval".into(),
        approval_id: Some(approval_id),
        fallback_text: format!("{agent} wants to: {title}. Answer in Weilo."),
        title,
        body: None,
        details: details(tool.raw_input.as_ref()),
        risk,
        risk_line: risk_line.into(),
        actions,
    }
}

fn risk(tool: &ToolInfo) -> (RiskClass, &'static str) {
    if looks_like_send(&tool.title) {
        return (RiskClass::Send, "Can't unsend");
    }
    match tool.kind {
        Some(ToolKind::Read | ToolKind::Search | ToolKind::Think) => {
            (RiskClass::Read, "Changes nothing")
        }
        Some(ToolKind::Edit | ToolKind::Move) => (RiskClass::Reversible, "Changes your files"),
        Some(ToolKind::Execute) => (RiskClass::Reversible, "Runs a command"),
        Some(ToolKind::Delete) => (RiskClass::Destructive, "Deletes files"),
        Some(ToolKind::Fetch) => (RiskClass::Reversible, "Opens a web page"),
        _ => (RiskClass::Reversible, "Can undo"),
    }
}

fn looks_like_send(title: &str) -> bool {
    let t = title.to_lowercase();
    [
        "send", "post", "email", "publish", "submit", "tweet", "git push",
    ]
    .iter()
    .any(|w| {
        t.split(|c: char| !c.is_alphanumeric() && c != ' ')
            .any(|part| part.contains(w))
    })
}

/// A command when there is one, otherwise the input as pretty JSON.
fn details(raw: Option<&serde_json::Value>) -> Option<String> {
    let raw = raw?;
    if let Some(cmd) = raw.get("command").and_then(|c| c.as_str()) {
        return Some(cmd.to_string());
    }
    if let Some(s) = raw.as_str() {
        return Some(s.to_string());
    }
    serde_json::to_string_pretty(raw).ok()
}

/// The option to answer the engine with. Allowing is always "allow once", even for
/// Always allow, so the engine never stores a rule of its own. `None` means cancel
/// (also when the engine offers no "allow once").
pub fn allow_once(req: &RequestPermissionRequest, decision: &Decision) -> Option<String> {
    use PermissionOptionKind::*;
    let order: &[PermissionOptionKind] = match decision {
        Decision::Allow | Decision::AllowAlways { .. } => &[AllowOnce],
        Decision::Deny => &[RejectOnce, RejectAlways],
    };
    order.iter().find_map(|kind| {
        req.options
            .iter()
            .find(|o| o.kind == *kind)
            .map(|o| o.option_id.0.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::{
        PermissionOption, ToolCallUpdate, ToolCallUpdateFields,
    };

    fn request(kind: ToolKind, title: &str) -> RequestPermissionRequest {
        let fields = ToolCallUpdateFields::new()
            .kind(kind)
            .title(title.to_string())
            .raw_input(serde_json::json!({ "command": "npm test -- checkout" }));
        RequestPermissionRequest::new(
            "s1",
            ToolCallUpdate::new("t1", fields),
            vec![
                PermissionOption::new("a", "Allow", PermissionOptionKind::AllowOnce),
                PermissionOption::new("aa", "Always", PermissionOptionKind::AllowAlways),
                PermissionOption::new("r", "Reject", PermissionOptionKind::RejectOnce),
            ],
        )
    }

    #[test]
    fn execute_card_runs_a_command() {
        let req = request(ToolKind::Execute, "Run the shop's checks");
        let card = permission_card(
            "Ava",
            Uuid::nil(),
            &tool_info(&req, None),
            Some(AlwaysScope::Folder),
        );
        assert_eq!(card.risk, RiskClass::Reversible);
        assert_eq!(card.risk_line, "Runs a command");
        assert_eq!(card.details.as_deref(), Some("npm test -- checkout"));
        let labels: Vec<_> = card.actions.iter().map(|a| a.label.as_str()).collect();
        assert_eq!(labels, ["Allow", "Always allow in this folder", "Not now"]);
        assert_eq!(card.actions.iter().filter(|a| a.primary).count(), 1);
    }

    #[test]
    fn sends_are_flagged_and_reads_change_nothing() {
        let req = request(ToolKind::Execute, "Send the invoice email");
        assert_eq!(
            permission_card(
                "Ava",
                Uuid::nil(),
                &tool_info(&req, None),
                Some(AlwaysScope::Folder)
            )
            .risk,
            RiskClass::Send
        );
        let req = request(ToolKind::Read, "Read the checkout code");
        assert_eq!(
            permission_card(
                "Ava",
                Uuid::nil(),
                &tool_info(&req, None),
                Some(AlwaysScope::Folder)
            )
            .risk,
            RiskClass::Read
        );
    }

    #[test]
    fn decisions_pick_matching_options() {
        let req = request(ToolKind::Execute, "x");
        assert_eq!(allow_once(&req, &Decision::Allow).as_deref(), Some("a"));
        let always = Decision::AllowAlways {
            scope: "folder".into(),
        };
        // The engine never hears "always".
        assert_eq!(allow_once(&req, &always).as_deref(), Some("a"));
        assert_eq!(allow_once(&req, &Decision::Deny).as_deref(), Some("r"));
        let mut only_always = req.clone();
        only_always
            .options
            .retain(|o| o.kind != PermissionOptionKind::AllowOnce);
        assert_eq!(allow_once(&only_always, &always), None);
    }

    #[test]
    fn rules_match_the_command_not_the_title() {
        let a = tool_info(&request(ToolKind::Execute, "Run the checks"), None);
        let b = tool_info(&request(ToolKind::Execute, "Something else"), None);
        assert_eq!(rule_key(&a), rule_key(&b));
        assert_eq!(
            rule_key(&a).as_deref(),
            Some("execute:npm test -- checkout")
        );
        let mut c = a.clone();
        c.raw_input = Some(serde_json::json!({ "command": "npm  test --  checkout && rm -rf /" }));
        assert_ne!(rule_key(&a), rule_key(&c));
        c.raw_input = Some(serde_json::json!({ "command": ["npm", "test", "--", "checkout"] }));
        assert_eq!(rule_key(&a), rule_key(&c));
        let mut d = a.clone();
        d.kind = Some(ToolKind::Delete);
        assert_ne!(rule_key(&a), rule_key(&d));
        d.raw_input = None;
        assert_eq!(rule_key(&d), None);
        let card = permission_card("Ava", Uuid::nil(), &d, None);
        assert!(!card.actions.iter().any(|a| a.id == "always"));
    }
}
