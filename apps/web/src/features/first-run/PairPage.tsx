import { useState, type FormEvent } from "react";
import { Button } from "../../ui/Button";
import { ErrorLine } from "../../ui/bits";
import { inputClass } from "../../ui/Dialog";

/** POST /api/pair; the host sets a cookie and we start again at home. */
export async function pair(code: string): Promise<string | null> {
  try {
    const res = await fetch("/api/pair", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    });
    if (res.ok) return null;
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
      return "That code didn't work. Check it and try again.";
    }
    if (res.status === 410) return "That code has expired. Run weilo pair again for a new one.";
    if (res.status === 429) return "Too many tries. Wait a minute and try again.";
    return "Your Weilo computer couldn't pair this device. Try again.";
  } catch {
    return "Can't reach your Weilo computer. Check that it's on.";
  }
}

export function PairPage({ code: initial }: { code: string }) {
  const [code, setCode] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    const err = await pair(code);
    setBusy(false);
    if (err) setError(err);
    else window.location.replace("/");
  };

  return (
    <div className="flex h-full justify-center overflow-y-auto bg-bg">
      <main className="safe-top flex w-full max-w-[400px] flex-col gap-6 px-4 pt-24 pb-8 md:px-6">
        <div className="flex flex-col gap-2">
          <h1 className="m-0 text-display font-semibold tracking-[-0.01em]">Pair this device</h1>
          <p className="m-0 text-text-secondary">
            Type the code your Weilo computer shows. Don't see one? Run <code className="rounded-sm bg-surface-muted px-1 text-text">weilo pair</code> there.
          </p>
        </div>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-text-secondary">Code</span>
            <input
              className={`${inputClass} h-10 font-mono tracking-wider`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
              aria-invalid={!!error}
              aria-describedby={error ? "pair-error" : undefined}
            />
          </label>
          {error && <ErrorLine id="pair-error">{error}</ErrorLine>}
          <Button type="submit" variant="primary" size="lg" className="max-md:h-12 max-md:text-phone" disabled={busy || !code.trim()}>
            {busy ? "Pairing…" : "Pair"}
          </Button>
        </form>
      </main>
    </div>
  );
}
