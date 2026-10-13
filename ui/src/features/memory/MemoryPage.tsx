import { useEffect, useState } from "react";
import { messageOf } from "../../api/http";
import { getMemory, saveMemory, setCurator } from "../../api/memory";
import { choosableOf, shortName, type Model, type Provider } from "../../api/providers";
import { Button, IconButton } from "../../components/ui/Button";
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
// A note in MEMORY.md: "- [m1 2026-10] Prefers short answers", or "- text" written by hand (the daemon numbers it when
// it saves). Other lines (the heading) are not notes.
const NOTE = /^- (?:\[(m\d+)(?: ([\d-]+))?\] )?(.+)$/;
const monthOf = (when?: string) => {
  const date = new Date(`${when}-01T00:00:00`);
  return when && !Number.isNaN(date.getTime()) ? date.toLocaleDateString([], { month: "short", year: "numeric" }) : "Not saved yet";
};

/** What all agents remember: the curator that keeps the knowledge vault, and the notes in MEMORY.md, one by one (or the
 *  file's text, to change it all at once). */
export function MemoryPage({ providers, models }: Props) {
  const [model, setModel] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);
  // The note being changed: its line, and what it says so far.
  const [editing, setEditing] = useState<{ i: number; note: string } | null>(null);
  const [adding, setAdding] = useState("");
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
    ...providers.filter((p) => p.connected).flatMap((p) => choosableOf(models ?? [], p.id).map((m) => ({ value: m.id, label: shortName(m.name) }))),
  ];
  const pick = (next: string) => run("model", async () => setModel((await setCurator(next)).model));

  const lines = text.split("\n");
  const notes = lines.flatMap((line, i) => {
    const m = NOTE.exec(line);
    return m ? [{ i, when: m[2], note: m[3] }] : [];
  });
  /** Changes line `i` (null removes it). From the newest text: leaving a note and forgetting another come in one tap. */
  const setLine = (i: number, change: (line: string) => string | null) =>
    setText((current) =>
      current
        .split("\n")
        .flatMap((line, j) => (j !== i ? [line] : (change(line) ?? [])))
        .join("\n"),
    );
  // A note is one line, and keeps its id and date; one left empty is gone.
  const finish = () => {
    if (!editing) return;
    const { i, note } = editing;
    const one = note.replace(/\s+/g, " ").trim();
    setEditing(null);
    setLine(i, (line) => (one ? line.replace(NOTE, (_, id?: string, when?: string) => `- ${id ? `[${id}${when ? ` ${when}` : ""}] ` : ""}${one}`) : null));
  };
  const add = () => {
    const note = adding.replace(/\s+/g, " ").trim();
    if (!note) return;
    setText((current) => `${current.trimEnd()}${current.trim() ? "\n" : ""}- ${note}\n`);
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
          <div className="pick w-full min-w-0 sm:w-44">
            <Select label="Knowledge curator model" value={model} disabled={!models || busy === "model"} onChange={(v) => void pick(v)} options={options} />
          </div>
        </Row>
        <Row
          title="Notes about you"
          description={notes.length ? `${notes.length === 1 ? "1 note" : `${notes.length} notes`}. Tap one to change it.` : "Agents save notes here as they learn about you."}
          below={
            raw ? (
              <textarea aria-label="MEMORY.md" value={text} rows={9} spellCheck={false} onChange={(e) => setText(e.target.value)} placeholder="- Prefers short answers" className="input resize-y font-mono text-[12.5px] leading-relaxed" />
            ) : (
              <ul className="flex flex-col gap-2">
                {notes.map(({ i, when, note }) => (
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
                  </li>
                ))}
                <li>
                  <form onSubmit={(e) => (e.preventDefault(), add())} className="flex items-center gap-2">
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
