import { cx } from "../lib/format";

export interface SwitchProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
}

export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        "flex h-5 w-8 shrink-0 rounded-full border-0 p-0.5 transition-colors",
        checked ? "justify-end bg-accent" : "justify-start bg-border-strong",
      )}
    >
      <span className="size-4 rounded-full bg-knob shadow-e1" />
    </button>
  );
}
