import { useEffect, useId, useState } from "react";
import { checkEngine, setEngineKey, showNotice } from "../../lib/app";
import { KEY_LINKS } from "../../lib/engines";
import { engineTitle } from "../../lib/format";
import type { EngineInfo } from "../../proto/EngineInfo";
import type { KeyProvider } from "../../proto/KeyProvider";
import { Button } from "../../ui/Button";
import { ChoiceChips } from "../../ui/ChoiceChips";
import { Dialog, inputClass } from "../../ui/Dialog";
import { CheckIcon } from "../../ui/glyphs";
import { useEngineList } from "./EnginePicker";

/** The provider to start on: one without a key yet, else the first. */
export function firstProvider(providers: KeyProvider[]): string {
  return (providers.find((p) => !p.has_key) ?? providers[0])?.id ?? "";
}

/** What a provider chip says. A saved key is only ever "Saved", never shown. */
export function providerLabel(p: KeyProvider): string {
  return p.has_key ? `${p.title} · Saved` : p.title;
}

/** State for pasting a key. The key lives only in this form and is cleared once saved. */
export function useKeyForm(engine: EngineInfo | undefined) {
  const providers = engine?.key_providers ?? [];
  const [provider, setProvider] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = providers.find((p) => p.id === provider) ?? providers.find((p) => p.id === firstProvider(providers));
  const save = async (): Promise<boolean> => {
    if (!engine || !chosen || !key.trim()) return false;
    setBusy(true);
    setError(null);
    try {
      await setEngineKey(engine.id, chosen.id, key.trim());
      setKey("");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That key wasn't saved. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (!engine || !chosen) return;
    setBusy(true);
    setError(null);
    try {
      await setEngineKey(engine.id, chosen.id, "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That key wasn't removed. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return { providers, chosen, setProvider, key, setKey, busy, error, save, remove, reset: () => setKey("") };
}

export type KeyForm = ReturnType<typeof useKeyForm>;

/** Company, key (a password field) and a guided "Get a key" link. */
export function KeyFields({ form, autoFocus }: { form: KeyForm; autoFocus?: boolean }) {
  const id = useId();
  const [removing, setRemoving] = useState(false);
  const { providers, chosen } = form;
  useEffect(() => setRemoving(false), [chosen?.id]);
  if (!chosen) return <p className="m-0 text-body-sm text-text-secondary">This AI doesn't take a key.</p>;
  const link = KEY_LINKS[chosen.id];
  return (
    <div className="flex flex-col gap-3">
      {providers.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-text-secondary">Key from</span>
          <ChoiceChips
            label="Key from"
            value={chosen.id}
            onChange={form.setProvider}
            items={providers.map((p) => ({ id: p.id, label: providerLabel(p) }))}
          />
        </div>
      )}
      {chosen.has_key && (
        <div className="flex min-h-7 flex-wrap items-center gap-2 text-body-sm text-text-secondary" role="status">
          <CheckIcon className="shrink-0 text-success" />
          {removing ? (
            <>
              <span className="min-w-0 flex-1">Remove the saved {chosen.title} key?</span>
              <Button size="sm" variant="tertiary" onClick={() => setRemoving(false)} disabled={form.busy}>
                Back
              </Button>
              <Button
                size="sm"
                variant="danger-solid"
                disabled={form.busy}
                onClick={async () => {
                  await form.remove();
                  setRemoving(false);
                }}
              >
                Remove
              </Button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1">Saved.</span>
              <Button size="sm" variant="tertiary" onClick={() => setRemoving(true)}>
                Remove
              </Button>
            </>
          )}
        </div>
      )}
      <label className="flex flex-col gap-1.5" htmlFor={id}>
        <span className="text-caption font-medium text-text-secondary">{chosen.title} API key</span>
        <input
          id={id}
          type="password"
          className={`${inputClass} font-mono placeholder:font-sans`}
          value={form.key}
          onChange={(e) => form.setKey(e.target.value)}
          placeholder={chosen.has_key ? "Paste a new key to replace it" : "Paste your key"}
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          autoFocus={autoFocus}
        />
      </label>
      {link && (
        <a href={link.url} target="_blank" rel="noopener noreferrer" className="w-fit text-body-sm font-medium">
          Get a key from {link.where} ↗
        </a>
      )}
    </div>
  );
}

/** What the key dialog says when the saved key doesn't work: plainly, then the check's own line. */
export function keyFailedLine(message: string | null | undefined): string {
  const m = message?.trim();
  if (!m) return "That key didn't work.";
  return /didn't work|did not work|isn't valid|invalid/i.test(m) ? m : `That key didn't work. ${m}`;
}

/** Add, replace or remove an engine's key. A saved key is never shown, only "Saved". */
export function KeyDialog({
  open,
  onClose,
  engineId,
  onSaved,
}: {
  open: boolean;
  onClose(): void;
  engineId: string;
  /** After a key is saved (the dialog then checks the engine and says how it went). */
  onSaved?: () => void;
}) {
  const engines = useEngineList(open);
  const engine = engines?.find((e) => e.id === engineId);
  const form = useKeyForm(engine);
  const title = engineTitle(engineId, engines ?? undefined);
  // What the check after saving found, when the key didn't work.
  const [failed, setFailed] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (open) setFailed(null);
  }, [open]);
  const close = () => {
    form.reset();
    setFailed(null);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add a key"
      description={`For ${title}. Weilo keeps it on this computer.`}
      submitLabel={checking ? "Checking…" : "Save key"}
      busy={form.busy || checking}
      error={form.error ?? failed}
      canSubmit={!!form.key.trim() && !!form.chosen}
      onSubmit={async () => {
        setFailed(null);
        if (!(await form.save())) return;
        onSaved?.();
        // Say honestly whether the key works: only a working key closes with "Saved".
        setChecking(true);
        try {
          const c = await checkEngine(engineId);
          if (c.ready) {
            close();
            showNotice(`Saved. ${c.message}`);
          } else {
            setFailed(keyFailedLine(c.message));
          }
        } catch {
          close();
          showNotice("Saved. Weilo couldn't check it just now.");
        } finally {
          setChecking(false);
        }
      }}
    >
      {!engines ? <p className="m-0 text-body-sm text-text-secondary">Loading…</p> : <KeyFields form={form} autoFocus />}
    </Dialog>
  );
}
