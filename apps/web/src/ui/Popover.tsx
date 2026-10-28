import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "../lib/format";

export interface PopoverProps {
  open: boolean;
  onClose(): void;
  label: string;
  className?: string;
  children: ReactNode;
}

/**
 * A small floating panel with controls (lists of actions use Menu). Place it inside a
 * `relative` wrapper with the button that opens it.
 * Escape or a click outside closes it, and focus goes back to the button.
 */
export function Popover({ open, onClose, label, className, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        opener?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const wrap = el?.parentElement;
      if (wrap && !wrap.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={cx(
        "absolute z-30 flex flex-col gap-0.5 rounded-lg border border-border bg-surface p-2 text-body-sm shadow-e2",
        className,
      )}
    >
      {children}
    </div>
  );
}
