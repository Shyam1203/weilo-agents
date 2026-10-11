import type { KeyboardEvent } from "react";

/**
 * Tabs: a row of pills, the selected one filled. The one way the app switches between views of a thing.
 * `panel`: the id of the element that shows the selected tab (role tabpanel, labelled by `${panel}-tab-${value}`).
 * The arrow keys move between the tabs, as in any tab list.
 */
export function Tabs<T extends string>({ label, tabs, value, onChange, panel }: { label: string; tabs: { value: T; label: string }[]; value: T; onChange: (value: T) => void; panel?: string }) {
  const onKeyDown = (e: KeyboardEvent) => {
    const at = tabs.findIndex((t) => t.value === value);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length].value;
    onChange(next);
    document.getElementById(`${panel ?? label}-tab-${next}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-1 self-start rounded-xl bg-panel p-1 ring-1 ring-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          id={`${panel ?? label}-tab-${t.value}`}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          aria-controls={panel}
          tabIndex={value === t.value ? 0 : -1}
          onClick={() => onChange(t.value)}
          className={`rounded-lg px-3.5 py-1.5 text-[13px] transition-colors ${value === t.value ? "bg-select font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
