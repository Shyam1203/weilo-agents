import type { ReactNode } from "react";
import type { WorkState } from "../proto/WorkState";
import { cx } from "../lib/format";
import { AlertIcon } from "./glyphs";

/** "Needs you" on accent-subtle, "Working" on surface-muted. Nothing when idle. */
export function StatusPill({ state }: { state: WorkState }) {
  if (state === "idle") return null;
  const needs = state === "needs_you";
  return (
    <span
      className={cx(
        "flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-2 text-caption font-medium whitespace-nowrap",
        needs ? "bg-accent-subtle text-accent-text" : "bg-surface-muted text-text-secondary",
      )}
    >
      <span aria-hidden="true" className={cx("size-1.5 rounded-full", needs ? "bg-accent" : "bg-success")} />
      {needs ? "Needs you" : "Working"}
    </span>
  );
}

/** A badge means "needs you". */
export function Badge({ count, label }: { count: number; label?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={label ?? `${count} need you`}
      className="flex h-5 min-w-5 items-center justify-center rounded-full bg-badge px-1 text-caption font-semibold text-on-badge"
    >
      {count}
    </span>
  );
}

/** Unread is a dot. */
export function Dot({ tone = "accent", label }: { tone?: "accent" | "warning"; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cx("size-1.5 shrink-0 rounded-full", tone === "accent" ? "bg-accent" : "bg-warning")}
    />
  );
}

/** Empty states: one bold line, one plain line, at most one button. */
export function EmptyState({
  title,
  line,
  action,
  className,
}: {
  title: string;
  line?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-start gap-2 text-body-sm text-text-secondary", className)}>
      <p className="m-0">
        <b className="font-semibold text-text">{title}</b>
        {line ? ` ${line}` : null}
      </p>
      {action}
    </div>
  );
}

/** A 56px top bar with the inset bottom line. */
export function TopBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header className={cx("flex h-14 shrink-0 items-center gap-3 shadow-line", className)}>{children}</header>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-sm border border-border px-1 font-sans text-caption text-text-tertiary">{children}</kbd>
  );
}

/** "That didn't work" in plain words: quiet, one line, never red (§11.3, §11.5). */
export function ErrorLine({ children, id, className }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <p
      id={id}
      role="alert"
      className={cx("m-0 flex items-start gap-2 rounded-md bg-surface-muted px-3 py-2 text-body-sm text-text-secondary", className)}
    >
      <AlertIcon className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** A plain line that may name a command in backticks ("run `claude`"): the command is drawn as code. */
export function TextWithCode({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <code key={i} className="rounded-sm bg-surface-muted px-1 text-[0.92em] text-text">
            {p}
          </code>
        ) : (
          p
        ),
      )}
    </>
  );
}
