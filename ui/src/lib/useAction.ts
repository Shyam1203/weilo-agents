import { useState } from "react";
import { messageOf } from "../api/http";

/** Runs an action: `busy` names the one running, `error` says why the last one failed. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
}
