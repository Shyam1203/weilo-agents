import { useEffect, useRef, useState } from "react";
import { getPush } from "../../api/push";
import { messageOf } from "../../api/http";
import { thisDevice, turnOn, unsupported } from "../../lib/push";
import { KEYS, read, write } from "../../lib/storage";

const canOffer = () => !read(KEYS.notifyAsked) && !thisDevice() && !unsupported() && Notification.permission !== "denied";

/**
 * Offers notifications when they would have helped: the agent finished while the app was in the
 * background. Asked once per browser; Settings > General has them too.
 */
export function useNotifyOffer(busy: boolean) {
  const [offer, setOffer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const was = useRef(busy);
  useEffect(() => {
    if (was.current && !busy && document.visibilityState === "hidden" && canOffer()) setOffer(true);
    was.current = busy;
  }, [busy]);
  const dismiss = () => (write(KEYS.notifyAsked, "1"), setOffer(false));
  const accept = async () => {
    try {
      await turnOn((await getPush()).publicKey);
      dismiss();
    } catch (err) {
      setError(messageOf(err));
    }
  };
  return { offer, error, accept, dismiss };
}
