import { useState } from "react";
import { retryLast } from "../../lib/app";
import { problemKind } from "../../lib/engines";
import { engineOfThread, useApp } from "../../lib/store";
import { TextWithCode } from "../../ui/bits";
import { Button, type ButtonSize } from "../../ui/Button";
import { AlertIcon } from "../../ui/glyphs";
import { EngineHelpDialog } from "../engines/EngineHelpDialog";
import { KeyDialog } from "../engines/KeyDialog";
import { NewSessionDialog } from "../shell/dialogs";

/**
 * Something went wrong, in one line, with the host's button. Once it was dealt with (a
 * later reply, or the message sent again) the line stays, quietly, without a button.
 */
export function Problem({
  threadId,
  agentId,
  message,
  action,
  resolved,
}: {
  threadId: string;
  agentId: string | null;
  message: string;
  action: string | null;
  resolved?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-muted px-3 py-2 text-body-sm text-text-secondary" role="note">
      <AlertIcon className="shrink-0" />
      <span className="min-w-0 flex-1">
        <TextWithCode text={message} />
      </span>
      {!resolved && <ProblemButton threadId={threadId} agentId={agentId} action={action} size="sm" />}
    </div>
  );
}

/**
 * A problem's own button: Try again sends the last message again; Sign in and Install say
 * how (in a small dialog); Add a key opens the key dialog; Choose another folder starts a
 * new session. A label we don't know gets no button rather than one that does nothing.
 */
export function ProblemButton({
  threadId,
  agentId,
  action,
  size = "sm",
  className,
}: {
  threadId: string;
  agentId: string | null;
  action: string | null;
  size?: ButtonSize;
  className?: string;
}) {
  const kind = problemKind(action);
  const engine = useApp((s) => engineOfThread(s, threadId, agentId));
  const paused = useApp((s) => s.paused !== null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const needsEngine = kind === "sign_in" || kind === "key" || kind === "install";
  if (kind === null || (needsEngine && !engine)) return null;

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
    <>
      <Button size={size} className={className} onClick={() => void onClick()} disabled={busy || (kind === "retry" && paused)}>
        {action}
      </Button>
      {engine && kind === "key" && <KeyDialog open={open} onClose={() => setOpen(false)} engineId={engine} />}
      {engine && (kind === "sign_in" || kind === "install") && (
        <EngineHelpDialog open={open} onClose={() => setOpen(false)} engineId={engine} kind={kind} />
      )}
      {kind === "folder" && <NewSessionDialog open={open} onClose={() => setOpen(false)} />}
    </>
  );
}
