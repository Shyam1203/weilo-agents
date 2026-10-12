import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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

/**
 * A dropdown in the app's own style (the browser's can't be styled). The list is drawn in <body>,
 * so a dialog's scroll area never clips it; it opens upward when there is more room above.
 */
export function Select({ label, value, options, onChange, placeholder = "", disabled = false }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; placeholder?: string; disabled?: boolean }) {
  const [place, setPlace] = useState<Place | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);
  const open = place !== null;

  const show = () => {
    const r = trigger.current!.getBoundingClientRect();
    const below = innerHeight - r.bottom - MARGIN;
    const above = r.top - MARGIN;
    const up = below < ROOM && above > below;
    // Measured on the screen; the list's style is in the page's own (unzoomed) sizes.
    const z = zoom();
    setPlace({ left: r.left / z, minWidth: r.width / z, ...(up ? { bottom: (innerHeight - r.top) / z + GAP, maxHeight: above / z } : { top: r.bottom / z + GAP, maxHeight: below / z }) });
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setPlace(null);
    const outside = (e: Event) => !list.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node);
    const onDown = (e: MouseEvent) => outside(e) && close();
    const onScroll = (e: Event) => outside(e) && close();
    // Capture, so a dialog around the list does not also close on this Escape.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      close();
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const onListKey = (e: KeyboardEvent) => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    items[(to + items.length) % items.length]?.focus();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setPlace(null) : show())}
        className="input flex h-10 items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? (value || placeholder)}</span>
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
