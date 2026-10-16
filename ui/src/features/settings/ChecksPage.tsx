import { useEffect, useState } from "react";
import type { Agent } from "../../api/agents";
import { messageOf } from "../../api/http";
import { getSecurity, type AuditEntry, type SecurityReport } from "../../api/security";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { List, Loading } from "../../components/ui/List";
import { Card, Page, Row } from "../../components/ui/Row";
import { longWhen } from "../../lib/format";

const PAGE = 10;

function describe(entry: AuditEntry, names: Map<string, string>) {
  const agent = (id?: string) => (id && names.get(id)) || id || "";
  if (entry.event === "approval") return `${agent(entry.agent)} asked: ${entry.question} — ${entry.answer}`;
  if (entry.event === "device paired") return `A device was paired (${entry.name ?? "a browser"})`;
  if (entry.event === "pairing refused") return `A pairing code was refused: ${entry.reason}`;
  const [method, path = ""] = entry.event.split(" ");
  const what = path.replace(/^\/api\//, "").replace(":id", agent(entry.id)).replace(":rid", entry.rid ?? "");
  return `${{ POST: "Added or did", PUT: "Changed", DELETE: "Removed" }[method] ?? method}: ${what}`;
}

export function ChecksPage({ agents, section }: { agents: Agent[]; section?: boolean }) {
  const [report, setReport] = useState<SecurityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => void getSecurity().then(setReport, (e) => setError(messageOf(e))), []);
  if (!report) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  const names = new Map(agents.map((a) => [a.id, a.name]));
  const by = (who?: string) => (who?.startsWith("agent ") ? names.get(who.slice(6)) ?? who : who ? "you" : "");
  return (
    <Page section={section} title="Checks and activity" description="Things to check, and recent changes.">
      <Card>
        {report.checks.map((c) => (
          <Row key={c.title} tile={<Icon name={c.ok ? "check" : "alert"} size={16} className={`shrink-0 ${c.ok ? "text-ink-3" : "text-bad"}`} />} title={c.title} description={c.detail} />
        ))}
      </Card>
      <h3 className="label">Recent activity</h3>
      <List items={report.activity.slice(0, shown)} empty="Nothing yet.">
        {(entry) => <Row key={`${entry.at}${entry.event}`} title={describe(entry, names)} description={`${longWhen(Date.parse(entry.at) / 1000)}${entry.by ? ` · by ${by(entry.by)}` : ""}`} />}
      </List>
      {report.activity.length > shown && (
        <Button size="sm" onClick={() => setShown(shown + PAGE)} className="self-center">
          Show more
        </Button>
      )}
    </Page>
  );
}
