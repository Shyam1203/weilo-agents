import { useCallback, useRef, useState } from "react";
import { cx } from "../lib/format";
import { inputClass } from "./Dialog";
import { CheckIcon, ChevronDownIcon } from "./glyphs";
import { Menu, MenuItem } from "./Menu";

export interface SelectOption {
  id: string;
  label: string;
}

/** Choose one of a few: a box that shows the choice and opens our own list (not the browser's). */
export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange(id: string): void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const chosen = options.find((o) => o.id === value);
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={chosen ? `${label}: ${chosen.label}` : label}
        onClick={() => setOpen((v) => !v)}
        className={cx(inputClass, "flex items-center gap-2 text-left")}
      >
        <span className="ellipsis flex-1">{chosen?.label ?? ""}</span>
        <ChevronDownIcon size={12} className="shrink-0 text-text-secondary" />
      </button>
      <Menu open={open} onClose={close} anchor={button} label={label} align="start" matchWidth className="max-h-72 overflow-y-auto">
        {options.map((o) => (
          <MenuItem
            key={o.id}
            checked={o.id === value}
            onSelect={() => {
              onChange(o.id);
              setOpen(false);
            }}
          >
            <span className="ellipsis flex-1">{o.label}</span>
            {o.id === value && <CheckIcon className="shrink-0 text-accent-text" />}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
