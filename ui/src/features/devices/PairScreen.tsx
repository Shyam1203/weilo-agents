// The screen of a browser that is not paired yet: it types a code from a paired device (or opens a link with one, which
// pairs it at once). Agents reach the app the way a browser does, so being on this computer or the tailnet is not enough.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { pairThisDevice } from "../../api/devices";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { Logo } from "../../components/ui/Logo";
import { useAction } from "../../lib/useAction";

/** The code in the address (?pair=), taken out of it so a reload does not use it again. */
function codeInAddress() {
  const url = new URL(location.href);
  const code = url.searchParams.get("pair");
  if (code) {
    url.searchParams.delete("pair");
    history.replaceState(null, "", url);
  }
  return code ?? "";
}

export function PairScreen({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState(codeInAddress);
  const { busy, error, run } = useAction();
  const pair = (value: string) => run("pair", async () => (await pairThisDevice(value), onPaired()));
  const submit = (e: FormEvent) => (e.preventDefault(), void pair(code));

  // A link with a code pairs at once.
  const tried = useRef(false);
  useEffect(() => {
    if (!code || tried.current) return;
    tried.current = true;
    void pair(code);
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <form onSubmit={submit} className="flex w-full max-w-sm animate-fade-in flex-col gap-4">
        <Logo size={36} />
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight">Pair this device</h1>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">Only your paired phones and computers can open Weilo Agents. Type the code from a device that is already paired.</p>
        </div>
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD-EFGH"
          aria-label="Pairing code"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          className="input text-center font-mono text-[17px] tracking-[0.2em]"
        />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" variant="primary" busy={busy === "pair"} disabled={code.replace(/[^A-Za-z0-9]/g, "").length < 8}>
          Pair
        </Button>
        <div className="flex flex-col gap-2 text-[12.5px] leading-relaxed text-ink-3">
          <p>
            <span className="font-medium text-ink-2">Get a code:</span> on a paired device, open Settings, then Devices, then Add a device.
          </p>
          <p>
            <span className="font-medium text-ink-2">No paired device yet?</span> Run the start script on the computer where Weilo Agents runs: it opens a link that pairs that browser. Or run <code>docker exec weilo-core node /app/pair.mjs</code> there and open the link it prints.
          </p>
        </div>
      </form>
    </div>
  );
}
