import { useEffect, useRef } from "react";
import { Icon, type IconName } from "../../components/ui/Icon";

/** A shortcut offered when a message starts with "/": what it is called, and the text it puts in the box. */
export interface Shortcut {
  group: "Commands" | "Skills" | "Plugins";
  label: string;
  description: string;
  insert: string;
  icon: IconName;
}

/** The list's id, which the message box points to. */
export const COMMAND_LIST = "shortcuts";

interface Props {
  shortcuts: Shortcut[];
  active: number;
  onPick: (shortcut: Shortcut) => void;
  /** Said instead of the list when there is nothing to pick. */
  hint?: string;
  /** Offered beside the hint: where to turn skills and plugins on. */
  onEdit?: () => void;
}

/** The shortcuts above the message box, in a section per group; the box keeps focus, and the arrow keys and Enter work from there. */
export function CommandMenu({ shortcuts, active, onPick, hint, onEdit }: Props) {
  const list = useRef<HTMLUListElement>(null);

  // A long list scrolls, and the arrow keys keep the chosen one in view (the first also shows its heading).
  useEffect(() => {
    if (active === 0) list.current?.scrollTo({ top: 0 });
    else list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <ul ref={list} id={COMMAND_LIST} role="listbox" aria-label="Shortcuts" className="absolute bottom-full left-0 z-30 mb-2 max-h-64 w-full max-w-sm animate-rise overflow-y-auto rounded-xl border border-line bg-raised p-1 shadow-pop">
      {shortcuts.map((s, i) => (
        <li key={s.group + s.label} role="presentation">
          {s.group !== shortcuts[i - 1]?.group && <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">{s.group}</p>}
          <button
            type="button"
            role="option"
            id={`${COMMAND_LIST}-${i}`}
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(s)}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-select ${i === active ? "bg-select" : ""}`}
          >
            <Icon name={s.icon} size={15} className="shrink-0 text-ink-2" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px]">{s.label}</span>
              {s.description && <span className="block truncate text-xs text-ink-3">{s.description}</span>}
            </span>
          </button>
        </li>
      ))}
      {hint && (
        <li className="flex items-center justify-between gap-3 px-2.5 py-2 text-[13px] text-ink-3">
          <span>{hint}</span>
          {onEdit && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onEdit} className="shrink-0 font-medium text-ink underline underline-offset-2">
              Edit agent
            </button>
          )}
        </li>
      )}
    </ul>
  );
}
