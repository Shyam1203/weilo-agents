import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { IconTile } from "./Tag";

interface Option<T extends string> {
  value: T;
  label: ReactNode;
  detail?: ReactNode;
  icon?: IconName;
}

/**
 * One choice among a few, as selectable cards: in a row (`columns`), or stacked with details.
 * Every radio-style picker in the app is this.
 */
export function Choice<T extends string>({ label, value, onChange, options, columns }: { label: string; value: T; onChange: (value: T) => void; options: Option<T>[]; columns?: number }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      // Phones fit two cards in a row; an odd number of cards stacks instead of leaving one alone.
      className={columns ? `grid gap-2 sm:grid-cols-[repeat(var(--columns),minmax(0,1fr))] ${options.length % 2 ? "grid-cols-1" : "grid-cols-2"}` : "flex flex-col gap-2"}
      style={columns ? ({ "--columns": columns } as CSSProperties) : undefined}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-left ring-1 transition-colors ring-inset ${on ? "bg-select ring-ink" : "ring-line-strong hover:bg-select"}`}
          >
            {o.icon && <IconTile icon={o.icon} />}
            <span className="min-w-0 flex-1">
              <span className={`block text-[13.5px] ${on ? "font-medium" : ""}`}>{o.label}</span>
              {o.detail && <span className="block text-xs leading-relaxed text-ink-3">{o.detail}</span>}
            </span>
            {on && !columns && <Icon name="check" size={15} />}
          </button>
        );
      })}
    </div>
  );
}
