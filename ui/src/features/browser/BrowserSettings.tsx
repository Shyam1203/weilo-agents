import { useEffect, useState } from "react";
import { getRule, saveRule, type Rule } from "../../api/browser";
import { messageOf } from "../../api/http";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { Loading } from "../../components/ui/List";
import { Card, Page, Row } from "../../components/ui/Row";
import { Switch } from "../../components/ui/Switch";
import { MAX_RULE } from "../../lib/limits";
import { useAction } from "../../lib/useAction";

/** When agents must ask you before they use a website. */
export function BrowserSettings() {
  const [rule, setRule] = useState<Rule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => void getRule().then(setRule, (e) => setLoadError(messageOf(e))), []);
  if (!rule) return loadError ? <ErrorText>{loadError}</ErrorText> : <Loading />;

  const change = (next: Rule) => (setRule(next), setSaved(false));
  const save = () => run("save", async () => (change(await saveRule(rule)), setSaved(true)));

  return (
    <Page title="Browser" description="Agents use a browser on this computer. It keeps your logins, so agents can use sites you are signed in to. Agents follow the rule below, but it is a request to them, not a lock.">
      <Card>
        <Row title="Ask me first" description="Ask before an agent does something it cannot undo.">
          <Switch label="Ask me first" checked={rule.ask} onChange={(ask) => change({ ...rule, ask })} />
        </Row>
        {rule.ask && (
          <Row
            title="What to ask about"
            description="Agents read this rule and ask you first."
            below={<textarea aria-label="What to ask about" value={rule.rule} rows={4} maxLength={MAX_RULE} onChange={(e) => change({ ...rule, rule: e.target.value })} className="input resize-none" />}
          />
        )}
      </Card>
      <ErrorText>{error}</ErrorText>
      <div className="flex items-center justify-end gap-3">
        {saved && <span className="text-[13px] text-ink-3">Saved.</span>}
        <Button variant="primary" busy={!!busy} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Page>
  );
}
