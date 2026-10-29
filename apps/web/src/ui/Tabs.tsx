import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { cx } from "../lib/format";

export interface TabItem {
  id: string;
  label: string;
  lead?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value: string | null;
  onChange(id: string): void;
  label: string;
  className?: string;
  /** Tab ids map to panels with this id prefix. */
  panelPrefix?: string;
  size?: "md" | "phone";
  /** Tabs keep their names and the row scrolls sideways (with a fade where more are hidden), instead of squeezing. */
  scroll?: boolean;
}

/** Which ends of a scrolling row have more past them. */
function useOverflow(el: RefObject<HTMLElement | null>, on: boolean) {
  const [more, setMore] = useState({ start: false, end: false });
  useEffect(() => {
    const node = el.current;
    if (!on || !node) return;
    const check = () => {
      const start = node.scrollLeft > 1;
      const end = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
      setMore((m) => (m.start === start && m.end === end ? m : { start, end }));
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(node);
    for (const c of Array.from(node.children)) ro.observe(c);
    node.addEventListener("scroll", check, { passive: true });
    return () => {
      ro.disconnect();
      node.removeEventListener("scroll", check);
    };
  }, [el, on]);
  return more;
}

const FADE = "24px";

/** A selected tab is a surface-muted fill, never a ring. Arrow keys move between tabs. */
export function Tabs({ items, value, onChange, label, className, panelPrefix, size = "md", scroll = false }: TabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const list = useRef<HTMLDivElement>(null);
  const more = useOverflow(list, scroll);
  // The open tab is always in view.
  const selectedIndex = items.findIndex((t) => t.id === value);
  useEffect(() => {
    if (!scroll || selectedIndex < 0) return;
    refs.current[selectedIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [scroll, selectedIndex]);
  const mask =
    scroll && (more.start || more.end)
      ? `linear-gradient(to right, ${more.start ? "transparent" : "#000"}, #000 ${more.start ? FADE : "0px"}, #000 calc(100% - ${more.end ? FADE : "0px"}), ${more.end ? "transparent" : "#000"})`
      : undefined;
  const onKey = (e: KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(items[next]!.id);
  };
  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      className={cx("flex min-w-0 items-center gap-1", scroll ? "no-scrollbar overflow-x-auto" : "overflow-hidden", className)}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      {items.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={panelPrefix ? `${panelPrefix}-tab-${t.id}` : undefined}
            aria-controls={panelPrefix ? `${panelPrefix}-panel` : undefined}
            aria-selected={selected}
            tabIndex={selected || (value === null && i === 0) ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            title={t.label}
            className={cx(
              "flex items-center gap-1.5 rounded-sm border-0 font-medium transition-colors",
              // Scrolling: whole names, up to a sensible length.
              scroll ? "max-w-[16rem] shrink-0" : "min-w-0 shrink",
              size === "phone" ? "h-11 px-3 text-phone" : "h-7 text-body-sm",
              size === "md" && (t.lead ? "pr-2 pl-1" : "px-2"),
              selected ? "bg-surface-muted text-text" : "ghost bg-transparent text-text-secondary",
            )}
          >
            {t.lead}
            <span className="ellipsis">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
