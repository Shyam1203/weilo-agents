import { useEffect, useState } from "react";
import { getUpdate, setUpdateCheck, type Update } from "../../api/app";
import { messageOf } from "../../api/http";
import { getVersion, type Build } from "../../api/version";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { Card, Page, Row } from "../../components/ui/Row";
import { Switch } from "../../components/ui/Switch";

export function AboutPage() {
  const [build, setBuild] = useState<Build | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void getVersion().then(setBuild, () => {});
    void getUpdate().then(setUpdate, () => {});
  }, []);
  const value = (text?: string) => <span className="text-[13px] text-ink-2">{text ?? "…"}</span>;
  const toggle = (enabled: boolean) =>
    setUpdateCheck(enabled).then(
      (u) => (setUpdate(u), setError(null)),
      (err) => setError(messageOf(err)),
    );

  return (
    <Page title="About" description="Include the version when you ask for help.">
      <Card>
        <Row title="Weilo Agents">{value(build?.version)}</Row>
        <Row title="Build">{value(build ? build.commit.slice(0, 7) : undefined)}</Row>
        <Row title="Pi coding agent">{value(build?.pi)}</Row>
      </Card>
      <Card>
        <Row
          title={update?.available ? `Version ${update.latest} is available` : "Updates"}
          description={
            update?.available
              ? "Run update.cmd (Windows) or update.sh in your Weilo Agents folder. Without them, download the new zip once and unzip it over the folder. Your chats and settings stay in ~/.weilo-agents."
              : update?.enabled === false
                ? "Checking for updates is off."
                : update?.latest
                  ? "You have the newest version."
                  : "Checks GitHub for a newer version now and then."
          }
        >
          {update?.available && update.url && (
            <a href={update.url} target="_blank" rel="noreferrer noopener">
              <Button size="sm" variant="primary" icon="external">
                Get it
              </Button>
            </a>
          )}
        </Row>
        <Row title="Check for updates" description="Asks GitHub for the newest version. Nothing else is sent.">
          <Switch checked={update?.enabled ?? true} onChange={(on) => void toggle(on)} label="Check for updates" />
        </Row>
      </Card>
      <ErrorText>{error}</ErrorText>
    </Page>
  );
}
