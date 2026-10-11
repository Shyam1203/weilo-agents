import { useEffect, useState } from "react";
import { getVersion, type Build } from "../../api/version";
import { Card, Page, Row } from "../../components/ui/Row";

export function AboutPage() {
  const [build, setBuild] = useState<Build | null>(null);
  useEffect(() => void getVersion().then(setBuild, () => {}), []);
  const value = (text?: string) => <span className="text-[13px] text-ink-2">{text ?? "…"}</span>;
  return (
    <Page title="About" description="Include the version when you ask for help.">
      <Card>
        <Row title="Weilo Agents">{value(build?.version)}</Row>
        <Row title="Build">{value(build ? build.commit.slice(0, 7) : undefined)}</Row>
        <Row title="Pi coding agent">{value(build?.pi)}</Row>
      </Card>
    </Page>
  );
}
