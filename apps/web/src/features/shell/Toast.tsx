import { useLayoutEffect, useState, type CSSProperties } from "react";
import { clearError } from "../../lib/app";
import { cx } from "../../lib/format";
import { useApp } from "../../lib/store";
import { flushUndo, undoPending } from "../../lib/undo";
import { Button } from "../../ui/Button";
import { TextWithCode } from "../../ui/bits";
import { CloseIcon } from "../../ui/glyphs";
import { IconButton } from "../../ui/IconButton";

/**
 * A calm one-line note at the bottom: that something didn't work (an alert, read out at
 * once) or that it did (a polite status, whose region stays so changes in it are read out).
 */
export function Toast() {
  const error = useApp((s) => s.error);
  const notice = useApp((s) => s.notice);
  const undo = useApp((s) => s.undo);
  const place = useToastPlace(!!(error || notice || undo));
  return (
    <div
      className={cx(
        "pointer-events-none fixed z-50 flex flex-col items-center gap-2 px-4",
        !place && "inset-x-0 bottom-6 max-md:bottom-24",
      )}
      style={place ?? undefined}
    >
      {/* An alert is read out when it appears, so it only exists while there's one. */}
      {error && (
        <div role="alert">
          <ToastLine text={error} />
        </div>
      )}
      <div role="status" aria-live="polite">
        {undo ? (
          <ToastLine key={undo.id} text={undo.text} onDismiss={flushUndo}>
            <Button size="sm" variant="tertiary" className="text-accent-text" onClick={undoPending}>
              Undo
            </Button>
          </ToastLine>
        ) : (
          notice && <ToastLine text={notice} />
        )}
      </div>
    </div>
  );
}

function ToastLine({ text, children, onDismiss = clearError }: { text: string; children?: React.ReactNode; onDismiss?(): void }) {
  return (
    <div className="pointer-events-auto flex max-w-[480px] items-center gap-2 rounded-lg border border-border bg-surface py-1 pr-1 pl-4 text-body-sm text-text shadow-e2">
      <span className="min-w-0 flex-1">
        <TextWithCode text={text} />
      </span>
      {children}
      <IconButton label="Dismiss" size={28} onClick={onDismiss}>
        <CloseIcon size={12} />
      </IconButton>
    </div>
  );
}

/**
 * The only banners we show: when the Weilo computer can't be reached, and while it says
 * it isn't ready (its own one line; sending waits until it clears).
 */
export function ConnectionBanner() {
  const conn = useApp((s) => s.conn);
  const paused = useApp((s) => s.paused);
  const text = conn === "reconnecting" ? "Can't reach your Weilo computer. Trying again…" : paused;
  if (!text) return null;
  return (
    <div
      role="status"
      className="flex min-h-8 shrink-0 items-center justify-center bg-surface-muted px-4 py-1.5 text-center text-caption font-medium text-text-secondary shadow-line"
    >
      {text}
    </div>
  );
}

/** How far above the composer (and Jump to newest) a note sits. */
const ABOVE = 12;

/**
 * Where notes go: centred on the page's own column (not the window, so not under the
 * sidebar or side panel), just above the message box and never over it. Pages without one
 * get the bottom of that column. `null` until there is a page to measure.
 */
function useToastPlace(shown: boolean): CSSProperties | null {
  const [place, setPlace] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!shown) return;
    const measure = () => {
      const main = document.querySelector("main");
      if (!main) return setPlace(null);
      const m = main.getBoundingClientRect();
      const area = main.querySelector<HTMLElement>("[data-composer-area]");
      let top = m.bottom - 24 + ABOVE; // no composer: 24px up from the column's bottom
      if (area) {
        top = area.getBoundingClientRect().top;
        const jump = area.querySelector<HTMLElement>("[data-jump]");
        if (jump) top = Math.min(top, jump.getBoundingClientRect().top);
      } else if (window.matchMedia("(max-width: 767px)").matches) {
        // Phones: above the tab bar.
        top = Math.min(top, window.innerHeight - 96 + ABOVE);
      }
      const next = { left: m.left, width: m.width, bottom: Math.max(8, window.innerHeight - top + ABOVE) };
      setPlace((p) => (p && p.left === next.left && p.width === next.width && p.bottom === next.bottom ? p : next));
    };
    measure();
    // Follow the page while the note shows: another page opens, the panel opens, the
    // message box grows as people type (its height is a style), the window changes.
    let frame = 0;
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const mo = new MutationObserver(soon);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", soon);
    return () => {
      cancelAnimationFrame(frame);
      mo.disconnect();
      window.removeEventListener("resize", soon);
    };
  }, [shown]);
  return shown ? place : null;
}
