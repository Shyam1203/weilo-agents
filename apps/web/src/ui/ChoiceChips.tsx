import { useRef, type KeyboardEvent } from "react";
import { cx } from "../lib/format";

/** The chip the arrow keys go to from `index`: the next or previous one, wrapping round. */
export function stepChoice(index: number, count: number, key: string): number | null {
  if (count === 0) return null;
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/**
 * Choices drawn as a row of chips: a radio group, so Tab stops once (on the chosen chip)
 * and the arrow keys move the choice.
 */
export function ChoiceChips({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  items: Array<{ id: string; label: string; title?: string }>;
}) {
  const group = useRef<HTMLDivElement>(null);
  const current = Math.max(
    0,
    items.findIndex((it) => it.id === value),
  );
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = stepChoice(i, items.length, e.key);
    if (next === null) return;
    e.preventDefault();
    const it = items[next]!;
    onChange(it.id);
    group.current?.querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus();
  };
  return (
    <div ref={group} role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {items.map((it, i) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === current ? 0 : -1}
            title={it.title}
            onClick={() => onChange(it.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              "h-8 max-w-full rounded-md border px-3 text-body-sm font-medium max-md:h-11",
              on ? "border-accent bg-accent-subtle text-accent-text" : "ghost border-border bg-surface text-text",
            )}
          >
            <span className="ellipsis block">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
