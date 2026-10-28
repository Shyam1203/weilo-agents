import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { Button } from "./Button";
import { ErrorLine, TextWithCode } from "./bits";

export interface DialogProps {
  open: boolean;
  onClose(): void;
  title: string;
  /** One short line under the title. */
  description?: string;
  submitLabel: string;
  onSubmit(): void | Promise<void>;
  busy?: boolean;
  canSubmit?: boolean;
  error?: string | null;
  children?: ReactNode;
  /** `danger-solid` only for the confirm step of something that can't be undone. */
  submitVariant?: "primary" | "danger-solid";
  /** The other button's label ("Cancel"); "Close" for dialogs that only explain. */
  cancelLabel?: string;
}

/** A modal form with one primary button. Uses the native dialog for focus and Escape. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  submitLabel,
  onSubmit,
  busy,
  canSubmit = true,
  error,
  children,
  submitVariant = "primary",
  cancelLabel = "Cancel",
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal?.();
    }
    if (!open && d.open) {
      d.close();
      returnFocus(opener.current);
    }
  }, [open]);
  // Closed by going away (its row was removed): focus still goes somewhere sensible.
  useEffect(
    () => () => {
      if (ref.current?.open) returnFocus(opener.current);
    },
    [],
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy && canSubmit) void onSubmit();
  };
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-[min(400px,calc(100vw-32px))] rounded-lg border border-border bg-surface p-0 text-text shadow-e3 backdrop:bg-[rgba(12,10,9,0.5)]"
    >
      {open && (
        <form onSubmit={submit} className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="m-0 text-title-sm font-semibold">
              {title}
            </h2>
            {description && (
              <p id={descId} className="m-0 text-body-sm text-text-secondary">
                {description}
              </p>
            )}
          </div>
          {children}
          {error && (
            <ErrorLine>
              <TextWithCode text={error} />
            </ErrorLine>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="tertiary" onClick={onClose}>
              {cancelLabel}
            </Button>
            <Button variant={submitVariant} type="submit" disabled={busy || !canSubmit}>
              {submitLabel}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}

/**
 * Puts focus back on what opened a dialog (the ⋯ button, say). When that is gone, the
 * page's main area takes it, so keyboard users don't start over at the top.
 */
export function returnFocus(opener: HTMLElement | null): void {
  if (typeof document === "undefined") return;
  if (opener && opener.isConnected && opener !== document.body && !opener.closest("[inert], [hidden]")) {
    opener.focus({ preventScroll: true });
    if (document.activeElement === opener) return;
  }
  const main = document.querySelector<HTMLElement>("main");
  if (!main) return;
  if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
  main.focus({ preventScroll: true });
}

/** A labelled input row for dialogs. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-caption font-medium text-text-secondary">{label}</span>
      {children}
      {hint && <span className="text-caption text-text-secondary">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "h-8 w-full min-w-0 rounded-md border border-border-strong bg-surface px-2 text-body-sm text-text outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-md:h-11 max-md:text-phone";
