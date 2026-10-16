import { useEffect, useState } from "react";
import type { Agent } from "../../api/agents";
import { messageOf } from "../../api/http";
import { listActivity, type AuditEntry } from "../../api/activity";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { List, Loading } from "../../components/ui/List";
import { Page, Row } from "../../components/ui/Row";
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

export function ActivityPage({ agents, section }: { agents: Agent[]; section?: boolean }) {
  const [activity, setActivity] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => void listActivity().then(setActivity, (e) => setError(messageOf(e))), []);
  if (!activity) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  const names = new Map(agents.map((a) => [a.id, a.name]));
  const by = (who?: string) => (who?.startsWith("agent ") ? names.get(who.slice(6)) ?? who : who ? "you" : "");
  return (
    <Page section={section} title="Recent activity" description="What changed, and who changed it.">
      <List items={activity.slice(0, shown)} empty="Nothing yet.">
        {(entry) => <Row key={`${entry.at}${entry.event}`} title={describe(entry, names)} description={`${longWhen(Date.parse(entry.at) / 1000)}${entry.by ? ` · by ${by(entry.by)}` : ""}`} />}
      </List>
      {activity.length > shown && (
        <Button size="sm" onClick={() => setShown(shown + PAGE)} className="self-center">
          Show more
        </Button>
      )}
    </Page>
  );
}
