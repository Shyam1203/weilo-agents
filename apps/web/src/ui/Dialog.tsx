import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { Button } from "./Button";

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
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
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
      className="m-auto w-[min(400px,calc(100vw-32px))] rounded-lg border border-border bg-surface p-0 text-text shadow-e3 backdrop:bg-text/30"
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
            <p role="alert" className="m-0 text-caption font-medium text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy || !canSubmit}>
              {submitLabel}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
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
