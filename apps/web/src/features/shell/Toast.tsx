import { clearError } from "../../lib/app";
import { useApp } from "../../lib/store";
import { TextWithCode } from "../../ui/bits";
import { CloseIcon } from "../../ui/glyphs";
import { IconButton } from "../../ui/IconButton";

/**
 * A calm one-line note at the bottom: that something didn't work (an alert, read out at
 * once) or that it did (a polite status, whose region stays so changes in it are read out).
 */
export function Toast() {
  const error = useApp((s) => s.error);
  const notice = useApp((s) => s.notice);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4 max-md:bottom-24">
      {/* An alert is read out when it appears, so it only exists while there's one. */}
      {error && (
        <div role="alert">
          <ToastLine text={error} />
        </div>
      )}
      <div role="status" aria-live="polite">
        {notice && <ToastLine text={notice} />}
      </div>
    </div>
  );
}

function ToastLine({ text }: { text: string }) {
  return (
    <div className="pointer-events-auto flex max-w-[480px] items-center gap-2 rounded-lg border border-border bg-surface py-1 pr-1 pl-4 text-body-sm text-text shadow-e2">
      <span className="min-w-0 flex-1">
        <TextWithCode text={text} />
      </span>
      <IconButton label="Dismiss" size={28} onClick={clearError}>
        <CloseIcon size={12} />
      </IconButton>
    </div>
  );
}

/**
 * The only banners we show: when the Weilo computer can't be reached, and while it says
 * it isn't ready (its own one line; sending waits until it clears).
 */
export function ConnectionBanner() {
  const conn = useApp((s) => s.conn);
  const paused = useApp((s) => s.paused);
  const text = conn === "reconnecting" ? "Can't reach your Weilo computer. Trying again…" : paused;
  if (!text) return null;
  return (
    <div
      role="status"
      className="flex min-h-8 shrink-0 items-center justify-center bg-surface-muted px-4 py-1.5 text-center text-caption font-medium text-text-secondary shadow-line"
    >
      {text}
    </div>
  );
}
