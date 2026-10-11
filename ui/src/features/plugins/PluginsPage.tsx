import { useEffect, useState, type FormEvent } from "react";
import { addPlugin, pluginStatus, removePlugin, type Plugin, type PluginStatus } from "../../api/plugins";
import { Button, IconButton } from "../../components/ui/Button";
import { ErrorText, Field } from "../../components/ui/Field";
import { List, Loading } from "../../components/ui/List";
import { Page, Row } from "../../components/ui/Row";
import { matches, Search } from "../../components/ui/Search";
import { Tabs } from "../../components/ui/Tabs";
import { Tag } from "../../components/ui/Tag";
import { useAction } from "../../lib/useAction";

interface Props {
  plugins: Plugin[];
  onChange: () => void;
}

export function PluginsPage({ plugins, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Record<string, PluginStatus>>();
  const { busy, error, run } = useAction();

  // Whether they connect takes pi a few seconds (it starts each one), so it fills in after the list
  // shows, and is checked again only when the plugins change.
  const names = plugins.map((p) => p.name).join();
  useEffect(() => {
    setStatus(undefined);
    pluginStatus().then(setStatus, () => setStatus({}));
  }, [names]);

  const remove = (name: string) =>
    run(name, async () => {
      await removePlugin(name);
      onChange();
    });

  if (adding) return <AddPlugin onBack={() => setAdding(false)} onAdded={() => (setAdding(false), onChange())} />;

  return (
    <Page
      title="Plugins"
      description="Plugins connect agents to other tools and services. Turn on plugins for each agent in Edit agent."
      action={
        <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
          Add
        </Button>
      }
    >
      <ErrorText>{error}</ErrorText>
      {plugins.length > 0 && <Search value={query} onChange={setQuery} label="Search plugins" />}
      <List items={plugins.filter((p) => matches(query, p.name, p.detail))} empty={plugins.length ? "No plugins match." : "No plugins yet."}>
        {(p) => {
          const s = status?.[p.name];
          return (
            <Row
              key={p.name}
              icon="puzzle"
              title={p.name}
              description={
                <>
                  <span className="block truncate font-mono text-[11.5px]">{p.detail}</span>
                  {s?.error && <span className="block truncate text-bad">{s.error}</span>}
                </>
              }
            >
              {!status ? <Loading label="" /> : s?.state === "connected" ? <Tag>{s.tools} tools</Tag> : <Tag>Not connected</Tag>}
              <Button size="sm" variant="ghost" busy={busy === p.name} onClick={() => remove(p.name)}>
                Delete
              </Button>
            </Row>
          );
        }}
      </List>
    </Page>
  );
}

// "KEY=value" lines to an object; a line without "=" is an error.
function variablesOf(text: string) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const bad = lines.find((line) => !line.includes("="));
  if (bad) throw new Error(`Write "${bad}" as NAME=value.`);
  return Object.fromEntries(lines.map((line) => [line.slice(0, line.indexOf("=")).trim(), line.slice(line.indexOf("=") + 1).trim()]));
}

function AddPlugin({ onBack, onAdded }: { onBack: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"command" | "url">("command");
  const [command, setCommand] = useState("");
  const [variables, setVariables] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const { busy, error, run } = useAction();

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run("add", async () => {
      await addPlugin(kind === "command" ? { name: name.trim(), command, env: variablesOf(variables) } : { name: name.trim(), url, token });
      onAdded();
    });
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <IconButton icon="chevronLeft" label="Back" onClick={onBack} className="-ml-2" />
        <h3 className="text-[15px] font-semibold tracking-tight">Add plugin</h3>
      </div>
      <Field label="Name">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="github" className="input" />
      </Field>
      <Tabs
        label="Kind"
        tabs={[
          { value: "command", label: "Command" },
          { value: "url", label: "Web address" },
        ]}
        value={kind}
        onChange={setKind}
      />
      {kind === "command" ? (
        <>
          <Field label="Command" hint="The command that starts the plugin. Copy it from the plugin documentation.">
            <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx -y @modelcontextprotocol/server-github" className="input font-mono text-[13px]" />
          </Field>
          <Field label="Variables" hint="Values the plugin needs, one on each line. For example: GITHUB_TOKEN=abc. Optional.">
            <textarea value={variables} onChange={(e) => setVariables(e.target.value)} rows={3} className="input resize-y font-mono text-[13px]" />
          </Field>
        </>
      ) : (
        <>
          <Field label="Web address">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" className="input font-mono text-[13px]" />
          </Field>
          <Field label="Access token" hint="Only if the plugin needs a token. Optional.">
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className="input" />
          </Field>
        </>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button onClick={onBack}>Cancel</Button>
        <Button type="submit" variant="primary" busy={!!busy} disabled={!name.trim() || !(kind === "command" ? command.trim() : url.trim())}>
          Add plugin
        </Button>
      </div>
    </form>
  );
}
