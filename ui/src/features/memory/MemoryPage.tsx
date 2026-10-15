import { useEffect, useState } from "react";
import { messageOf } from "../../api/http";
import { getMemory, saveMemory, setMemorySettings, type MemorySettings } from "../../api/memory";
import { choosableOf, shortName, type Model, type Provider } from "../../api/providers";
import { Button, IconButton } from "../../components/ui/Button";
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
const NOTE = /^- (?:\[([^\]]*)\] )?(.+)$/;
const KINDS = [
  { value: "preference", label: "Preference", group: "Preferences" },
  { value: "fact", label: "Fact", group: "Facts" },
  { value: "goal", label: "Goal", group: "Goals" },
  { value: "person", label: "Person", group: "People" },
  { value: "project", label: "Project", group: "Projects" },
  { value: "decision", label: "Decision", group: "Decisions" },
];
const MONTH = /^\d{4}-\d{2}$/;
const tagsOf = (bracket?: string) => {
  const tags = bracket?.split(/\s+/) ?? [];
  return tags.every((t) => /^m\d+$/.test(t) || MONTH.test(t) || KINDS.some((k) => k.value === t)) ? tags : null;
};
const STALE_MONTHS = 12;
const monthOf = (when?: string) => {
  const date = new Date(`${when}-01T00:00:00`);
  if (!when || Number.isNaN(date.getTime())) return "Not saved yet";
  const shown = date.toLocaleDateString([], { month: "short", year: "numeric" });
  const months = (new Date().getFullYear() - date.getFullYear()) * 12 + new Date().getMonth() - date.getMonth();
  return months >= STALE_MONTHS ? `Not confirmed since ${shown}: may be out of date` : shown;
};

export function MemoryPage({ providers, models }: Props) {
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  const [editing, setEditing] = useState<{ i: number; note: string } | null>(null);
  const [adding, setAdding] = useState("");
  const [addingKind, setAddingKind] = useState("fact");
  const { busy, error, run } = useAction();

  useEffect(
    () =>
      void getMemory().then(
        (m) => (setSettings(m), setText(m.text), setSaved(m.text)),
        (e) => setLoadError(messageOf(e)),
      ),
    [],
  );
  if (settings === null) return loadError ? <ErrorText>{loadError}</ErrorText> : <Loading />;
  const { model } = settings;

  const options = [
    { value: OFF, label: "Off" },
    ...(model && !(models ?? []).some((m) => m.id === model) ? [{ value: model, label: model }] : []),
    ...providers.filter((p) => p.connected).flatMap((p) => choosableOf(models ?? [], p.id).map((m) => ({ value: m.id, label: shortName(m.name) }))),
  ];
  const change = (next: Partial<MemorySettings>) => run("settings", async () => setSettings(await setMemorySettings(next)));

  const lines = text.split("\n");
  const notes = lines.flatMap((line, i) => {
    const m = NOTE.exec(line);
    if (!m) return [];
    const tags = tagsOf(m[1]);
    return [{ i, when: tags?.find((t) => MONTH.test(t)), kind: KINDS.find((k) => tags?.includes(k.value)) ?? KINDS[1], note: tags ? m[2] : `[${m[1]}] ${m[2]}` }];
  });
  const setLine = (i: number, change: (line: string) => string | null) =>
    setText((current) =>
      current
        .split("\n")
        .flatMap((line, j) => (j !== i ? [line] : (change(line) ?? [])))
        .join("\n"),
    );
  const finish = () => {
    if (!editing) return;
    const { i, note } = editing;
    const one = note.replace(/\s+/g, " ").trim();
    setEditing(null);
    const kept = (bracket?: string) => tagsOf(bracket)?.filter((t) => !MONTH.test(t)) ?? [];
    setLine(i, (line) => (one ? line.replace(NOTE, (_, bracket?: string) => `- ${kept(bracket).length ? `[${kept(bracket).join(" ")}] ` : ""}${one}`) : null));
  };
  const add = () => {
    const note = adding.replace(/\s+/g, " ").trim();
    if (!note) return;
    setText((current) => `${current.trimEnd()}${current.trim() ? "\n" : ""}- [${addingKind}] ${note}\n`);
    setAdding("");
  };
  const save = () =>
    run("save", async () => {
      const { text: next } = await saveMemory(text);
      setText(next);
      setSaved(next);
    });

  return (
    <Page title="Memory" description="All agents share one memory. The notes about you are read when a chat starts; the knowledge vault is searched when an agent needs it.">
      <Card>
        <Row title="Knowledge curator" description={model ? "Curated Knowledge from our conversations." : "Off. Choose a model to build the knowledge vault from your chats."}>
          <div className="pick w-full min-w-0 sm:w-56">
            <Select label="Knowledge curator model" value={model} disabled={!models || busy === "settings"} onChange={(v) => void change({ model: v })} options={options} />
          </div>
        </Row>
        <Row title="Ask before saving" description="An agent asks you in its chat before it saves or forgets a note about you.">
          <Switch label="Ask before saving" checked={settings.ask} onChange={(ask) => void change({ ask })} />
        </Row>
        <Row
          title="Notes about you"
          description={notes.length ? `${notes.length === 1 ? "1 note" : `${notes.length} notes`}. Tap one to change it.` : "Agents save notes here as they learn about you."}
          below={
            raw ? (
              <textarea aria-label="MEMORY.md" value={text} rows={9} spellCheck={false} onChange={(e) => setText(e.target.value)} placeholder="- Prefers short answers" className="input resize-y font-mono text-[12.5px] leading-relaxed" />
            ) : (
              <ul className="flex flex-col gap-2">
                {KINDS.flatMap((kind) => notes.filter((n) => n.kind === kind)).map(({ i, when, kind, note }, at, sorted) => [
                  sorted[at - 1]?.kind !== kind && (
                    <li key={kind.value} className="pt-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
                      {kind.group}
                    </li>
                  ),
                  <li key={i} className="flex items-start gap-2 rounded-xl bg-select/60 py-2 pr-1 pl-3">
                    {editing?.i === i ? (
                      <textarea
                        aria-label="Note"
                        autoFocus
                        value={editing.note}
                        rows={3}
                        onChange={(e) => setEditing({ i, note: e.target.value })}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && (e.preventDefault(), e.currentTarget.blur())}
                        onBlur={finish}
                        className="input min-w-0 flex-1 text-[13px] leading-relaxed"
                      />
                    ) : (
                      <button type="button" onClick={() => setEditing({ i, note })} className="min-w-0 flex-1 text-left">
                        <span className="block text-[13px] leading-relaxed text-ink [overflow-wrap:anywhere]">{note}</span>
                        <span className="mt-0.5 block text-[11px] text-ink-3">{monthOf(when)}</span>
                      </button>
                    )}
                    <IconButton icon="close" label="Forget this note" onClick={() => (setEditing(null), setLine(i, () => null))} />
                  </li>,
                ])}
                <li>
                  <form onSubmit={(e) => (e.preventDefault(), add())} className="flex items-center gap-2">
                    <div className="w-32 shrink-0">
                      <Select label="Kind of note" value={addingKind} onChange={setAddingKind} options={KINDS} />
                    </div>
                    <input aria-label="New note" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add a note: Prefers short answers" className="input min-w-0 flex-1 text-[13px]" />
                    <Button size="sm" type="submit" disabled={!adding.trim()}>
                      Add
                    </Button>
                  </form>
                </li>
              </ul>
            )
          }
        >
          <Button size="sm" variant="ghost" onClick={() => (setRaw(!raw), setEditing(null))}>
            {raw ? "Show as notes" : "Edit as text"}
          </Button>
        </Row>
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
