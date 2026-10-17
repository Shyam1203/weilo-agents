import { useEffect, useState } from "react";
import { messageOf } from "../../api/http";
import { getMemory, setMemory, type MemorySettings } from "../../api/memory";
import { choosableOf, shortName, type Model, type Provider } from "../../api/providers";
import { ErrorText } from "../../components/ui/Field";
import { Loading } from "../../components/ui/List";
import { Card, Page, Row } from "../../components/ui/Row";
import { Select } from "../../components/ui/Select";
import { Switch } from "../../components/ui/Switch";
import { useAction } from "../../lib/useAction";

interface Props {
  providers: Provider[];
  models?: Model[];
}

const OFF = "";

export function MemoryPage({ providers, models }: Props) {
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => void getMemory().then(setSettings, (e) => setLoadError(messageOf(e))), []);
  if (settings === null) return loadError ? <ErrorText>{loadError}</ErrorText> : <Loading />;
  const { model, notes } = settings;

  const options = [
    { value: OFF, label: "Off" },
    ...(model && !(models ?? []).some((m) => m.id === model) ? [{ value: model, label: model }] : []),
    ...providers.filter((p) => p.connected).flatMap((p) => choosableOf(models ?? [], p.id).map((m) => ({ value: m.id, label: shortName(m.name) }))),
  ];
  const change = (next: Partial<MemorySettings>) => run("settings", async () => setSettings(await setMemory(next)));

  return (
    <Page
      title="Memory"
      description={notes ? "Agents remember what they learn about you." : "Off. Agents don't save what they learn about you."}
      action={<Switch label="Memory" checked={notes} onChange={(on) => void change({ notes: on })} />}
    >
      <Card>
        <Row title="Knowledge curator" description={model ? "Curated Knowledge from our conversations." : "Off. Pick a model to turn it on."}>
          <div className="pick w-full min-w-0 sm:w-56">
            <Select label="Knowledge curator model" value={model} disabled={!models || busy === "settings"} onChange={(v) => void change({ model: v })} options={options} />
          </div>
        </Row>
      </Card>
      <ErrorText>{error}</ErrorText>
    </Page>
  );
}
