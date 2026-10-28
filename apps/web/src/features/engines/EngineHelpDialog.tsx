import { useEffect, useState } from "react";
import { checkEngine, showNotice } from "../../lib/app";
import { alreadySays, signInWays } from "../../lib/engines";
import { engineTitle } from "../../lib/format";
import { useApp } from "../../lib/store";
import type { EngineCheck } from "../../proto/EngineCheck";
import { TextWithCode } from "../../ui/bits";
import { Dialog } from "../../ui/Dialog";
import { useEngineList } from "./EnginePicker";

/** What the help dialog says, before and after Check again. */
export function helpText(kind: "sign_in" | "install", title: string, how: string | null | undefined, check: EngineCheck | undefined) {
  const line =
    how?.trim() ||
    (check && !check.ready ? check.message : null) ||
    (kind === "sign_in" ? `Open ${title} on this computer and sign in there.` : `Install ${title} on this computer.`);
  return {
    title: kind === "sign_in" ? `Sign in to ${title}` : `Install ${title}`,
    line,
    /** "You can sign in with ChatGPT or an API key." */
    ways: kind === "sign_in" ? signInWays(check?.auth_methods ?? []) : null,
  };
}

/**
 * "Sign in" and "Install": how to do it on this computer (there is no sign-in inside Weilo),
 * the ways the engine says it can sign in, and Check again.
 */
export function EngineHelpDialog({
  open,
  onClose,
  engineId,
  kind,
}: {
  open: boolean;
  onClose(): void;
  engineId: string;
  kind: "sign_in" | "install";
}) {
  const engines = useEngineList(open);
  const engine = engines?.find((e) => e.id === engineId);
  const check = useApp((s) => s.checks[engineId]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    if (open) setResult(null);
  }, [open]);
  const title = engineTitle(engineId, engines ?? undefined);
  const text = helpText(kind, title, engine?.how, check);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={text.title}
      submitLabel={busy ? "Checking…" : "Check again"}
      cancelLabel="Close"
      busy={busy}
      error={result}
      onSubmit={async () => {
        setBusy(true);
        setResult(null);
        try {
          const c = await checkEngine(engineId);
          if (c.ready) {
            onClose();
            showNotice(c.message);
          } else setResult(c.message);
        } catch (e) {
          setResult(e instanceof Error ? e.message : "That check didn't work. Try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {!alreadySays(result, text.line) && (
        <p className="m-0 text-body-sm text-text">
          <TextWithCode text={text.line} />
        </p>
      )}
      {text.ways && <p className="m-0 text-body-sm text-text-secondary">{text.ways}</p>}
      <p className="m-0 text-caption text-text-secondary">When you're done, check again here.</p>
    </Dialog>
  );
}
