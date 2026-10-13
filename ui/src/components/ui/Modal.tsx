import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EXIT_MS } from "../../lib/useExit";
import { IconButton } from "./Button";

interface Props {
  title: string;
  /** Shows a back arrow before the title (a page opened inside the dialog). */
  onBack?: () => void;
  onClose: () => void;
  /** Tailwind max-width class for the dialog. */
  width?: string;
  /** Kept mounted (its state stays) but out of sight, while something else is shown. */
  hidden?: boolean;
  /** No padding around the content: it fills the dialog (it has its own layout). */
  flush?: boolean;
  children: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog, rendered into <body> through a portal: an ancestor with a filter or backdrop-filter
 * would otherwise become the containing block of this fixed overlay and clip it.
 */
export function Modal({ title, onBack, onClose, width = "max-w-lg", hidden = false, flush = false, children }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  // Closing by hand (the close button, a click outside, Escape) lets the dialog animate out first.
  const [closing, setClosing] = useState(false);
  const dismiss = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, EXIT_MS);
  };
  const topmost = () => {
    const all = document.querySelectorAll('[role="dialog"]');
    return all[all.length - 1] === dialog.current;
  };

  // Focus moves into the dialog (unless a field there took it), and back where it was on close.
  // What had focus is read while rendering: a field's autoFocus takes it before effects run.
  const [before] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    const box = dialog.current;
    if (box && !box.contains(document.activeElement)) {
      const first = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].find((el) => el.getAttribute("aria-label") !== "Close");
      (first ?? box).focus();
    }
    return () => before?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Only the topmost dialog answers (a dialog can open another).
      if (hidden || !topmost()) return;
      if (e.key === "Escape") (e.preventDefault(), dismiss());
      // Tab stays inside the dialog.
      if (e.key === "Tab" && dialog.current) {
        const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!items.length) return;
        const [first, last] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss, hidden]);

  return createPortal(
    <div hidden={hidden} className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className={`absolute inset-0 bg-black/40 backdrop-blur-[2px] ${closing ? "animate-fade-out" : "animate-fade-in"}`} onClick={dismiss} aria-hidden="true" />
      <div
        ref={dialog}
        role={hidden ? undefined : "dialog"}
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`relative flex max-h-[calc(92dvh/var(--zoom))] w-full flex-col ${closing ? "pointer-events-none animate-sheet-out sm:animate-dialog-out" : "animate-sheet sm:animate-dialog"} overflow-hidden rounded-t-2xl outline-none border border-line bg-raised shadow-lift sm:rounded-2xl ${width}`}
      >
        <header className="flex items-start gap-3 px-6 pt-5 pb-1">
          {onBack && <IconButton icon="chevronLeft" label="Back" onClick={onBack} className="-mt-1 -ml-2" />}
          <h2 className="min-w-0 flex-1 text-[17px] font-semibold tracking-tight">{title}</h2>
          <IconButton icon="close" label="Close" onClick={dismiss} className="-mt-1 -mr-2" />
        </header>
        <div className={`min-h-0 flex-1 ${flush ? "flex" : "overflow-y-auto px-6 pt-4 pb-6"}`}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
