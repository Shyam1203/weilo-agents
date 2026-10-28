import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../lib/format";

export interface TabItem {
  id: string;
  label: string;
  lead?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value: string | null;
  onChange(id: string): void;
  label: string;
  className?: string;
  /** Tab ids map to panels with this id prefix. */
  panelPrefix?: string;
  size?: "md" | "phone";
}

/** A selected tab is a surface-muted fill, never a ring. Arrow keys move between tabs. */
export function Tabs({ items, value, onChange, label, className, panelPrefix, size = "md" }: TabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(items[next]!.id);
  };
  return (
    <div role="tablist" aria-label={label} className={cx("flex min-w-0 items-center gap-1 overflow-hidden", className)}>
      {items.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={panelPrefix ? `${panelPrefix}-tab-${t.id}` : undefined}
            aria-controls={panelPrefix ? `${panelPrefix}-panel` : undefined}
            aria-selected={selected}
            tabIndex={selected || (value === null && i === 0) ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            title={t.label}
            className={cx(
              "flex min-w-0 shrink items-center gap-1.5 rounded-sm border-0 font-medium transition-colors",
              size === "phone" ? "h-11 px-3 text-phone" : "h-7 text-body-sm",
              size === "md" && (t.lead ? "pr-2 pl-1" : "px-2"),
              selected ? "bg-surface-muted text-text" : "ghost bg-transparent text-text-secondary",
            )}
          >
            {t.lead}
            <span className="ellipsis">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
