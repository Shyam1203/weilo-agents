export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-ink" : "bg-ink-3"}`}
    >
      <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-page transition-transform ${checked ? "translate-x-4" : ""}`} />
    </button>
  );
}
