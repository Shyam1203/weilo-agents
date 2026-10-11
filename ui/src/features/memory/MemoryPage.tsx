import { useEffect, useState } from "react";
import { messageOf } from "../../api/http";
import { getMemory, saveMemory, setCurator } from "../../api/memory";
import { choosableOf, type Model, type Provider } from "../../api/providers";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { Loading } from "../../components/ui/List";
import { Card, Page, Row } from "../../components/ui/Row";
import { Select } from "../../components/ui/Select";
import { useAction } from "../../lib/useAction";

interface Props {
  providers: Provider[];
  models?: Model[];
}

const OFF = "";

/** What all agents remember: the curator that keeps the knowledge vault, and the MEMORY.md file. */
export function MemoryPage({ providers, models }: Props) {
  const [model, setModel] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  useEffect(
    () =>
      void getMemory().then(
        (m) => (setModel(m.model), setText(m.text), setSaved(m.text)),
        (e) => setLoadError(messageOf(e)),
      ),
    [],
  );
  if (model === null) return loadError ? <ErrorText>{loadError}</ErrorText> : <Loading />;

  const options = [
    { value: OFF, label: "Off" },
    ...(model && !(models ?? []).some((m) => m.id === model) ? [{ value: model, label: model }] : []),
    ...providers.filter((p) => p.connected).flatMap((p) => choosableOf(models ?? [], p.id).map((m) => ({ value: m.id, label: m.name }))),
  ];
  const pick = (next: string) => run("model", async () => setModel((await setCurator(next)).model));
  const save = () =>
    run("save", async () => {
      const { text: next } = await saveMemory(text);
      setText(next);
      setSaved(next);
    });

  return (
    <Page title="Memory" description="All agents share one memory. MEMORY.md is read when a chat starts; the knowledge vault is searched when an agent needs it.">
      <Card>
        <Row title="Knowledge curator" description={model ? "Curated Knowledge from our conversations." : "Off. Choose a model to build the knowledge vault from your chats."}>
          <div className="w-44">
            <Select label="Knowledge curator model" value={model} disabled={!models || busy === "model"} onChange={(v) => void pick(v)} options={options} />
          </div>
        </Row>
        <Row
          title="MEMORY.md"
          description="Facts about you"
          below={<textarea aria-label="MEMORY.md" value={text} rows={9} spellCheck={false} onChange={(e) => setText(e.target.value)} placeholder="- Prefers short answers" className="input resize-y font-mono text-[12.5px] leading-relaxed" />}
        />
      </Card>
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end">
        <Button variant="primary" busy={busy === "save"} disabled={text === saved} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Page>
  );
}
