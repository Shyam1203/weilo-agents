import { useState, type FormEvent, type ReactNode } from "react";
import { choosableOf, modelsOf, removeKey, saveKey, type Model, type Provider } from "../../api/providers";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { List } from "../../components/ui/List";
import { Page, Row } from "../../components/ui/Row";
import { LetterTile } from "../../components/ui/Tag";
import { useAction } from "../../lib/useAction";
import { ModelPicker } from "./ModelPicker";
import { SignIn } from "./SignIn";

interface Props {
  providers: Provider[];
  models?: Model[];
  onChange: () => void;
  onModels: (ids: string[]) => void;
}

export function ProvidersPage({ providers, models, onChange, onModels }: Props) {
  const connected = providers.filter((p) => p.connected);
  const others = providers.filter((p) => !p.connected);
  const row = (p: Provider) => <ProviderRow key={p.id} provider={p} models={models} onChange={onChange} onModels={onModels} />;
  return (
    <Page title="Providers" description="Your model accounts. They stay on this computer.">
      {connected.length > 0 && (
        <Group title="In use">
          <List items={connected} empty="">
            {row}
          </List>
        </Group>
      )}
      <Group title={connected.length ? "Add another" : "Add a provider"}>
        <List items={others} empty="Every provider is connected.">
          {row}
        </List>
      </Group>
    </Page>
  );
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-1.5">
    <h4 className="label">{title}</h4>
    {children}
  </section>
);

export function ProviderRow({ provider, models, onChange, onModels }: { provider: Provider; models?: Model[]; onChange: () => void; onModels: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
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
  const below = (provider.connected && picking) || open || signingIn || error;
  const keys = !!provider.keyUrl || !provider.signIn;
  const described = provider.account ? `Signed in with ${provider.signIn ?? "your account"}.` : provider.connected ? "Connected with an API key." : provider.signIn ? `Sign in with ${provider.signIn}${keys ? ", or use an API key" : ""}.` : "Use your own API key.";

  const all = provider.connected && models ? modelsOf(models, provider.id).length : 0;
  const choosable = all ? choosableOf(models!, provider.id).length : 0;
  const counted = all ? ` ${choosable === all ? `All ${all} models` : `${choosable} of ${all} models`} on.` : "";

  return (
    <Row
      tile={<LetterTile name={provider.name} />}
      title={provider.name}
      description={described + counted}
      below={
        below ? (
          <>
            {provider.connected && picking && <ModelPicker providerId={provider.id} models={models} onChange={onModels} />}
            {signingIn && <SignIn provider={provider} onDone={() => (setSigningIn(false), onChange())} onCancel={() => setSigningIn(false)} />}
            {open && (
              <form onSubmit={save} className="flex flex-col gap-2">
                <input autoFocus type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={provider.connected ? "New API key" : "API key"} aria-label={`${provider.name} API key`} className="input" />
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
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-good">
            <span className="size-1.5 rounded-full bg-good" />
            Connected
          </span>
          <Button size="sm" variant="ghost" aria-expanded={picking} onClick={() => (setPicking(!picking), setOpen(false))}>
            Models
          </Button>
          {!provider.account && (
            <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => (setOpen(!open), setPicking(false))}>
              Edit key
            </Button>
          )}
          <Button size="sm" variant="ghost" busy={!!busy} onClick={() => change(() => removeKey(provider.id))}>
            {provider.account ? "Sign out" : "Remove"}
          </Button>
        </>
      ) : (
        <>
          {provider.signIn && (
            <Button size="sm" variant={signingIn ? "ghost" : "primary"} aria-expanded={signingIn} onClick={() => (setSigningIn(!signingIn), setOpen(false))}>
              Sign in
            </Button>
          )}
          {keys && (
            <Button size="sm" variant={provider.signIn ? "ghost" : "secondary"} aria-expanded={open} onClick={() => (setOpen(!open), setSigningIn(false))}>
              Add key
            </Button>
          )}
        </>
      )}
    </Row>
  );
}
