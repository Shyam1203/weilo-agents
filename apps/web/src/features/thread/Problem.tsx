import { useState } from "react";
import { retryLast } from "../../lib/app";
import { problemKind } from "../../lib/engines";
import { engineOfThread, useApp } from "../../lib/store";
import { Button } from "../../ui/Button";
import { AlertIcon } from "../../ui/glyphs";
import { EngineHelpDialog } from "../engines/EngineHelpDialog";
import { KeyDialog } from "../engines/KeyDialog";
import { NewSessionDialog } from "../shell/dialogs";

/**
 * Something went wrong, in one line, with the host's button:
 * Try again sends the last message again; Sign in and Install say how (in a small dialog);
 * Add a key opens the key dialog; Choose another folder starts a new session.
 * A label we don't know gets no button rather than one that does nothing.
 */
export function Problem({
  threadId,
  agentId,
  message,
  action,
}: {
  threadId: string;
  agentId: string | null;
  message: string;
  action: string | null;
}) {
  const kind = problemKind(action);
  const engine = useApp((s) => engineOfThread(s, threadId, agentId));
  const paused = useApp((s) => s.paused !== null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const needsEngine = kind === "sign_in" || kind === "key" || kind === "install";
  const shown = kind !== null && (!needsEngine || !!engine);

  const onClick = async () => {
    if (kind === "retry") {
      setBusy(true);
      await retryLast(threadId);
      setBusy(false);
      return;
    }
    setOpen(true);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-body-sm text-text-secondary" role="note">
      <AlertIcon className="shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      {shown && (
        <Button size="sm" onClick={() => void onClick()} disabled={busy || (kind === "retry" && paused)}>
          {action}
        </Button>
      )}
      {engine && kind === "key" && <KeyDialog open={open} onClose={() => setOpen(false)} engineId={engine} />}
      {engine && (kind === "sign_in" || kind === "install") && (
        <EngineHelpDialog open={open} onClose={() => setOpen(false)} engineId={engine} kind={kind} />
      )}
      {kind === "folder" && <NewSessionDialog open={open} onClose={() => setOpen(false)} />}
    </div>
  );
}
