import { useEffect, useState } from "react";

export const EXIT_MS = 150;

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
