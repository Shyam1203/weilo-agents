import { useRef, useState, type ChangeEvent } from "react";
import { addExtension, removeExtension, type Extension } from "../../api/extensions";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { List } from "../../components/ui/List";
import { Modal } from "../../components/ui/Modal";
import { Page, Row } from "../../components/ui/Row";
import { matches, Search } from "../../components/ui/Search";
import { Tag } from "../../components/ui/Tag";
import { useAction } from "../../lib/useAction";

interface Props {
  extensions: Extension[];
  onChange: () => void;
}

export function ExtensionsPage({ extensions, onChange }: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState(false);
  const { busy, error, run } = useAction();
  const change = (name: string, action: () => Promise<void>) =>
    run(name, async () => {
      await action();
      onChange();
    });

  const add = (e: ChangeEvent<HTMLInputElement>) => {
    const [file] = e.target.files ?? [];
    e.target.value = "";
    if (file) void change("add", () => addExtension(file));
  };

  return (
    <Page
      title="Extensions"
      description="New tools for your agents."
      action={
        <>
          <input ref={picker} type="file" accept=".zip" onChange={add} className="hidden" />
          <Button size="sm" icon="plus" busy={busy === "add"} onClick={() => setAsking(true)}>
            Add
          </Button>
        </>
      }
    >
      <ErrorText>{error}</ErrorText>
      {extensions.length > 0 && <Search value={query} onChange={setQuery} label="Search extensions" />}
      <List items={extensions.filter((x) => matches(query, x.name, x.description))} empty={extensions.length ? "No extensions match." : "No extensions yet. Add an extension as a .zip file."}>
        {(x) => (
          <Row key={x.id} icon="plug" title={x.name} description={x.description}>
            {x.builtin ? (
              <Tag>Built in</Tag>
            ) : (
              <Button size="sm" variant="ghost" busy={busy === x.id} onClick={() => change(x.id, () => removeExtension(x.id))}>
                Delete
              </Button>
            )}
          </Row>
        )}
      </List>
      {asking && (
        <Modal title="Add an extension?" onClose={() => setAsking(false)} width="max-w-sm">
          <div className="flex flex-col gap-4">
            <p className="text-[14px] text-ink-2">An extension runs as a program inside each agent that uses it. It can read and change that agent's files and use its model account. Add only extensions from people you trust.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => (setAsking(false), picker.current?.click())}>
                Choose file
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Page>
  );
}
