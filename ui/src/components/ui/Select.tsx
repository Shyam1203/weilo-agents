import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { zoom } from "../../lib/zoom";
import { Icon } from "./Icon";

interface Option {
  value: string;
  label: string;
}

interface Place {
  left: number;
  minWidth: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

const GAP = 4;
const MARGIN = 12;
const ROOM = 220;

export function Select({ label, value, options, onChange, placeholder = "", disabled = false }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; placeholder?: string; disabled?: boolean }) {
  const [place, setPlace] = useState<Place | null>(null);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);
  const open = place !== null;

  const show = () => {
    const r = trigger.current!.getBoundingClientRect();
    const below = innerHeight - r.bottom - MARGIN;
    const above = r.top - MARGIN;
    const up = below < ROOM && above > below;
    const z = zoom();
    setPlace({ left: r.left / z, minWidth: r.width / z, ...(up ? { bottom: (innerHeight - r.top) / z + GAP, maxHeight: above / z } : { top: r.bottom / z + GAP, maxHeight: below / z }) });
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setPlace(null);
    const outside = (e: Event) => !list.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node);
    const onDown = (e: PointerEvent) => outside(e) && close();
    const onScroll = (e: Event) => outside(e) && close();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      close();
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const onListKey = (e: KeyboardEvent) => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Tab") return (e.preventDefault(), setPlace(null), trigger.current?.focus());
    const letter = e.key.length === 1 && e.key.trim() ? e.key.toLowerCase() : null;
    const typed = letter ? options.findIndex((o, i) => i > at && o.label.toLowerCase().startsWith(letter)) : -1;
    const to = letter ? (typed >= 0 ? typed : options.findIndex((o) => o.label.toLowerCase().startsWith(letter))) : { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key];
    if (to === undefined || to < 0) return;
    e.preventDefault();
    items[(to + items.length) % items.length]?.focus();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setPlace(null) : show())}
        className="input flex h-10 items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span id={`${id}-label`} className="sr-only">
          {label}
        </span>
        <span id={`${id}-value`} className="min-w-0 flex-1 truncate">
          {current?.label ?? (value || placeholder)}
        </span>
        <Icon name="chevronDown" size={15} className={`shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {place &&
        createPortal(
          <div
            ref={list}
            role="listbox"
            aria-label={label}
            onKeyDown={onListKey}
            style={place}
            className="fixed z-[60] w-max max-w-[min(24rem,calc(100vw-2rem))] animate-rise overflow-y-auto rounded-xl border border-line bg-raised p-1 shadow-pop"
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => {
                  setPlace(null);
                  onChange(o.value);
                  trigger.current?.focus();
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-ink transition-colors hover:bg-select"
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.value === value && <Icon name="check" size={14} className="text-ink-2" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
