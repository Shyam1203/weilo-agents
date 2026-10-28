import { cx } from "../lib/format";

/** Choices drawn as a row of chips (a radio group), not a native select. */
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
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="radio"
            aria-checked={on}
            title={it.title}
            onClick={() => onChange(it.id)}
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
