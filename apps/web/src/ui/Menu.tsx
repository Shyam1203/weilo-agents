import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cx } from "../lib/format";

export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MenuPlacement {
  top: number;
  left: number;
  /** Which side of the button it ended up on. */
  side: "below" | "above";
}

const GAP = 4;
const EDGE = 8;

/**
 * Where a menu goes: under its button (or over it, for `prefer: "above"`), flipping to the
 * other side when it wouldn't fit, lined up with the button's end or start edge, and kept
 * inside the window.
 */
export function placeMenu(
  anchor: Rect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: { align?: "start" | "end"; prefer?: "below" | "above" } = {},
): MenuPlacement {
  const align = opts.align ?? "end";
  const prefer = opts.prefer ?? "below";
  const belowTop = anchor.bottom + GAP;
  const aboveTop = anchor.top - GAP - size.height;
  const fitsBelow = belowTop + size.height <= viewport.height - EDGE;
  const fitsAbove = aboveTop >= EDGE;
  let side: "below" | "above";
  if (prefer === "below") side = fitsBelow || !fitsAbove ? "below" : "above";
  else side = fitsAbove || !fitsBelow ? "above" : "below";
  // Neither side fits: take the roomier one and keep it on screen.
  if (!fitsBelow && !fitsAbove) side = viewport.height - anchor.bottom >= anchor.top ? "below" : "above";
  let top = side === "below" ? belowTop : aboveTop;
  top = Math.max(EDGE, Math.min(top, viewport.height - EDGE - size.height));
  let left = align === "end" ? anchor.right - size.width : anchor.left;
  left = Math.max(EDGE, Math.min(left, viewport.width - EDGE - size.width));
  return { top: Math.round(top), left: Math.round(left), side };
}

export interface MenuProps {
  open: boolean;
  onClose(): void;
  /** The button that opens it: the menu is placed next to it and focus goes back to it. */
  anchor: RefObject<HTMLElement | null>;
  label: string;
  className?: string;
  align?: "start" | "end";
  prefer?: "below" | "above";
  children: ReactNode;
}

/**
 * A list of actions that floats next to its button. Drawn in a layer over the whole page
 * (a portal), so no row or panel can paint over it or catch its clicks. Arrow keys move,
 * Escape or a click outside closes it, and focus goes back to the button. Choosing an item
 * puts focus back on the button first, so a dialog it opens can return focus there.
 */
export function Menu({ open, onClose, anchor, label, className, align = "end", prefer = "below", children }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<MenuPlacement | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const a = anchor.current;
      const m = ref.current;
      if (!a || !m) return;
      const r = a.getBoundingClientRect();
      setPos(
        placeMenu(r, { width: m.offsetWidth, height: m.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, { align, prefer }),
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, align, prefer]);

  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    // The chosen one, for a menu that picks a value; else the first.
    (el?.querySelector<HTMLElement>(`[aria-checked=true]${ITEM_OK}`) ?? el?.querySelector<HTMLElement>(ITEMS_OK))?.focus();
    const back = () => anchor.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
        back();
      } else if (e.key === "Tab" && el?.contains(document.activeElement)) {
        e.preventDefault();
        onClose();
        back();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (el?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, onClose, anchor]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      data-side={pos?.side}
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
      className={cx(
        "fixed z-50 flex flex-col gap-0.5 rounded-lg border border-border bg-surface p-2 text-body-sm text-text shadow-e2",
        className,
      )}
      onClickCapture={(e) => {
        const item = (e.target as HTMLElement).closest(ITEMS);
        if (item && !(item as HTMLButtonElement).disabled) anchor.current?.focus();
      }}
      onKeyDown={(e) => {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>(ITEMS_OK) ?? [])];
        if (items.length === 0) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        let next: number | null = null;
        if (e.key === "ArrowDown") next = (i + 1) % items.length;
        else if (e.key === "ArrowUp") next = (i - 1 + items.length) % items.length;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = items.length - 1;
        if (next === null) return;
        e.preventDefault();
        items[next]?.focus();
      }}
    >
      {children}
    </div>,
    // Inside a dialog, in the dialog: the rest of the page can't be used while it is open.
    anchor.current?.closest("dialog") ?? document.body,
  );
}

const ITEMS = "[role=menuitem], [role=menuitemradio]";
const ITEM_OK = ":not([disabled])";
const ITEMS_OK = "[role=menuitem]:not([disabled]), [role=menuitemradio]:not([disabled])";

export function MenuItem({
  children,
  onSelect,
  disabled,
  checked,
}: {
  children: ReactNode;
  onSelect(): void;
  disabled?: boolean;
  /** Set for a menu that picks one value: this item is the chosen one (or not). */
  checked?: boolean;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className="ghost flex h-8 w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 text-left text-body-sm font-medium whitespace-nowrap text-text disabled:opacity-50 max-md:h-11"
    >
      {children}
    </button>
  );
}
