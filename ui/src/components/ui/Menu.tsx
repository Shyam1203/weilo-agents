import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useDismiss } from "../../lib/useDismiss";
import { useExit } from "../../lib/useExit";
import { Icon, type IconName } from "./Icon";

interface Props {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  placement?: "below-end" | "below-start" | "above-start";
  wide?: boolean;
  children: (close: () => void) => ReactNode;
}

const PLACEMENT = {
  "below-end": "top-full right-0 mt-1 origin-top-right",
  "below-start": "top-full left-0 mt-1 origin-top-left",
  "above-start": "bottom-full left-0 mb-1 origin-bottom-left",
};

export function Menu({ trigger, placement = "below-end", wide = false, children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    if (ref.current?.querySelector('[role="menu"]')?.contains(document.activeElement)) ref.current.querySelector("button")?.focus();
    setOpen(false);
  }, []);
  useDismiss(open, close, ref);
  const { shown, closing } = useExit(open);
  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];

  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Tab") return setOpen(false);
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[e.key];
    if (to === undefined || !list.length) return;
    e.preventDefault();
    list[(to + list.length) % list.length].focus();
  };

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {shown && (
        <div role="menu" onKeyDown={onKeyDown} className={`absolute z-30 ${closing ? "pointer-events-none animate-pop-out" : "animate-pop"} max-h-56 overflow-y-auto rounded-xl border border-line bg-raised p-1 shadow-pop ${wide ? "w-72 max-w-[calc(100vw-2rem)]" : "w-52"} ${PLACEMENT[placement]}`}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, label, onClick }: { icon?: IconName; label: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] transition-colors hover:bg-select text-ink"
    >
      {icon && <Icon name={icon} size={15} className="text-ink-2" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

