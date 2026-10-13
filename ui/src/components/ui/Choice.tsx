import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { IconTile } from "./Tag";

interface Option<T extends string> {
  value: T;
  label: ReactNode;
  detail?: ReactNode;
  icon?: IconName;
}

/**
 * One choice among a few, as selectable cards: short ones in a `row`, or stacked with details.
 * Every radio-style picker in the app is this.
 */
export function Choice<T extends string>({ label, value, onChange, options, row }: { label: string; value: T; onChange: (value: T) => void; options: Option<T>[]; row?: boolean }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      // A row wraps on a phone, three to a line, and the cards of the last line share its width.
      className={row ? "flex flex-wrap gap-2" : "flex flex-col gap-2"}
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
            className={`flex items-center gap-3 rounded-xl ring-1 ${row ? "flex-auto basis-[28%] justify-center px-2 py-2 sm:basis-0" : "px-3.5 py-2.5 text-left"} transition-colors ring-inset ${on ? "bg-select ring-ink" : "ring-line-strong hover:bg-select"}`}
          >
            {o.icon && <IconTile icon={o.icon} />}
            <span className={row ? "whitespace-nowrap" : "min-w-0 flex-1"}>
              <span className={`block text-[13.5px] ${on ? "font-medium" : ""}`}>{o.label}</span>
              {o.detail && <span className="block text-xs leading-relaxed text-ink-3">{o.detail}</span>}
            </span>
            {on && !row && <Icon name="check" size={15} />}
          </button>
        );
      })}
    </div>
  );
}
