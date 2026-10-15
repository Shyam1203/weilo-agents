import { useEffect, useState } from "react";
import type { Agent } from "../../api/agents";
import { messageOf } from "../../api/http";
import { getSecurity, type AuditEntry, type SecurityCheck } from "../../api/security";
import { ErrorText } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { Loading } from "../../components/ui/List";
import { Card, Page, Row } from "../../components/ui/Row";

const when = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function describe(entry: AuditEntry, names: Map<string, string>) {
  const agent = (id?: string) => (id && names.get(id)) || id || "";
  if (entry.event === "approval") return `${agent(entry.agent)} asked: ${entry.question} — ${entry.answer}`;
  if (entry.event === "device paired") return `A device was paired (${entry.name ?? "a browser"})`;
  if (entry.event === "pairing refused") return `A pairing code was refused: ${entry.reason}`;
  const [method, path = ""] = entry.event.split(" ");
  const what = path.replace(/^\/api\//, "").replace(":id", agent(entry.id)).replace(":rid", entry.rid ?? "");
  return `${{ POST: "Added or did", PUT: "Changed", DELETE: "Removed" }[method] ?? method}: ${what}`;
}

export function SecurityPage({ agents }: { agents: Agent[] }) {
  const [report, setReport] = useState<{ checks: SecurityCheck[]; activity: AuditEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void getSecurity().then(setReport, (e) => setError(messageOf(e))), []);
  if (!report) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  const names = new Map(agents.map((a) => [a.id, a.name]));
  const by = (who?: string) => (who?.startsWith("agent ") ? names.get(who.slice(6)) ?? who : who ? "you" : "");
  return (
    <Page title="Security" description="What to look at in this install, and the latest changes the app recorded (agent/audit.jsonl).">
      <Card>
        {report.checks.map((c) => (
          <Row key={c.title} tile={<Icon name={c.ok ? "check" : "alert"} size={16} className={`shrink-0 ${c.ok ? "text-ink-3" : "text-bad"}`} />} title={c.title} description={c.detail} />
        ))}
      </Card>
      <h3 className="label">Recent activity</h3>
      {report.activity.length ? (
        <Card>
          {report.activity.map((entry, i) => (
            <Row key={i} title={describe(entry, names)} description={`${when(entry.at)}${entry.by ? ` · by ${by(entry.by)}` : ""}`} />
          ))}
        </Card>
      ) : (
        <p className="text-xs text-ink-3">Nothing yet.</p>
      )}
    </Page>
  );
}
