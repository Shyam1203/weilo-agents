import { useEffect, useState } from "react";

/** How long (ms) a closing popover or dialog stays on screen to animate out (`--animate-pop-out`, `--animate-dialog-out`). */
export const EXIT_MS = 150;

/**
 * Keeps something on screen for a moment after it closes, so it can animate out: `shown` while it is open or closing,
 * `closing` while it animates out.
 */
export function useExit(open: boolean, ms = EXIT_MS) {
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useEffect(() => {
    if (open || !shown) return;
    const timer = setTimeout(() => setShown(false), ms);
    return () => clearTimeout(timer);
  }, [open, shown, ms]);
  return { shown: open || shown, closing: !open && shown };
}
