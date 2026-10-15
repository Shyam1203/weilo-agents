import { useEffect, useRef } from "react";

export function useBackStep(open: boolean, close: () => void) {
  const pushed = useRef(false);
  const onClose = useRef(close);
  onClose.current = close;

  useEffect(() => {
    if (open && !pushed.current) {
      history.pushState({ weiloStep: true }, "");
      pushed.current = true;
    } else if (!open && pushed.current) {
      pushed.current = false;
      if (history.state?.weiloStep) history.back();
    }
  }, [open]);

  useEffect(() => {
    if (history.state?.weiloStep && !pushed.current) history.replaceState(null, "");
    const onPop = () => {
      if (!pushed.current) return;
      pushed.current = false;
      onClose.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
