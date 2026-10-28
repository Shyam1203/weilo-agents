import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "../lib/format";

export interface PopoverProps {
  open: boolean;
  onClose(): void;
  label: string;
  className?: string;
  children: ReactNode;
  /** `dialog` for panels with controls, `menu` for a list of actions. */
  role?: "dialog" | "menu";
}

/**
 * A small floating panel. Place it inside a `relative` wrapper with the button that opens it.
 * Escape or a click outside closes it, and focus goes back to the button.
 */
export function Popover({ open, onClose, label, className, children, role = "dialog" }: PopoverProps) {
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
      role={role}
      aria-label={label}
      className={cx(
        "absolute z-30 flex flex-col gap-0.5 rounded-lg border border-border bg-surface p-2 text-body-sm shadow-e2",
        className,
      )}
      onKeyDown={
        role === "menu"
          ? (e) => {
              if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
              e.preventDefault();
              const items = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
              const i = items.indexOf(document.activeElement as HTMLElement);
              const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
              items[next]?.focus();
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

export function MenuItem({
  children,
  onSelect,
  disabled,
}: {
  children: ReactNode;
  onSelect(): void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className="ghost flex h-8 w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-body-sm font-medium text-text disabled:opacity-50"
    >
      {children}
    </button>
  );
}
