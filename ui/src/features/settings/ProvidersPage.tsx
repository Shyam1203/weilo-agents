import { useState, type FormEvent } from "react";
import { removeKey, saveKey, type Model, type Provider } from "../../api/providers";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { List } from "../../components/ui/List";
import { Page, Row } from "../../components/ui/Row";
import { Tag } from "../../components/ui/Tag";
import { useAction } from "../../lib/useAction";
import { ModelPicker } from "./ModelPicker";

interface Props {
  providers: Provider[];
  models?: Model[];
  onChange: () => void;
  onModels: (ids: string[]) => void;
}

export function ProvidersPage({ providers, models, onChange, onModels }: Props) {
  return (
    <Page title="Providers" description="Agents use your own account with a model provider. Keys stay on this computer.">
      <List items={providers} empty="No providers.">
        {(p) => <ProviderRow key={p.id} provider={p} models={models} onChange={onChange} onModels={onModels} />}
      </List>
    </Page>
  );
}

function ProviderRow({ provider, models, onChange, onModels }: { provider: Provider; models?: Model[]; onChange: () => void; onModels: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [key, setKey] = useState("");
  const { busy, error, run } = useAction();
  const change = (action: () => Promise<void>) =>
    run("key", async () => {
      await action();
      setOpen(false);
      setKey("");
      onChange();
    });

  const save = (e: FormEvent) => (e.preventDefault(), change(() => saveKey(provider.id, key.trim())));
  const below = (provider.connected && picking) || (!provider.connected && open) || error;

  return (
    <Row
      icon="plug"
      title={provider.name}
      description={provider.connected ? "Connected." : "Use your own API key."}
      below={
        below ? (
          <>
            {provider.connected && picking && <ModelPicker providerId={provider.id} models={models} onChange={onModels} />}
            {!provider.connected && open && (
              <form onSubmit={save} className="flex flex-col gap-2">
                <input autoFocus type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="API key" aria-label={`${provider.name} API key`} className="input" />
                <div className="flex items-center justify-between gap-2">
                  {provider.keyUrl ? (
                    <a href={provider.keyUrl} target="_blank" rel="noreferrer noopener" className="hint underline">
                      Get a key
                    </a>
                  ) : (
                    <span />
                  )}
                  <Button type="submit" variant="primary" size="sm" busy={!!busy} disabled={!key.trim()}>
                    Save
                  </Button>
                </div>
              </form>
            )}
            <ErrorText>{error}</ErrorText>
          </>
        ) : undefined
      }
    >
      {provider.connected ? (
        <>
          <Tag>Connected</Tag>
          <Button size="sm" variant="ghost" aria-expanded={picking} onClick={() => setPicking(!picking)}>
            Models
          </Button>
          <Button size="sm" variant="ghost" busy={!!busy} onClick={() => change(() => removeKey(provider.id))}>
            Remove
          </Button>
        </>
      ) : (
        <Button size="sm" onClick={() => setOpen(!open)}>
          Add key
        </Button>
      )}
    </Row>
  );
}
