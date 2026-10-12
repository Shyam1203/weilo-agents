import { useEffect, useRef } from "react";

/**
 * On a phone, a screen over the agent list (a chat, Settings) is a step in the browser's history: the phone's back button
 * or gesture closes it, as the app's own back arrow does, instead of leaving the app. While `open`, one step is there;
 * when it closes in the app, the step is taken back.
 */
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
    // A reload keeps the step the page was on; it is the list now.
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
