import { useEffect, useState } from "react";
import { listDevices, newPairingCode, unpairDevice, type PairedDevice } from "../../api/devices";
import { messageOf } from "../../api/http";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { Loading } from "../../components/ui/List";
import { Card, Page, Row } from "../../components/ui/Row";
import { useAction } from "../../lib/useAction";
import { useCopy } from "../../lib/useCopy";

const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

export function DevicesPage({ section }: { section?: boolean }) {
  const [devices, setDevices] = useState<PairedDevice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState<{ code: string; expires: string } | null>(null);
  const { busy, error, run } = useAction();
  const load = () => listDevices().then(setDevices, (e) => setLoadError(messageOf(e)));
  useEffect(() => void load(), []);
  if (!devices) return loadError ? <ErrorText>{loadError}</ErrorText> : <Loading />;

  const remove = (d: PairedDevice) => run(d.id, async () => (await unpairDevice(d.id), d.current ? location.reload() : await load()));
  return (
    <Page
      section={section}
      title="Devices"
      description="The phones and computers that can open Weilo Agents. A new one is paired once, with a code from here."
      action={
        <Button size="sm" icon="plus" busy={busy === "code"} onClick={() => void run("code", async () => setCode(await newPairingCode()))}>
          Add a device
        </Button>
      }
    >
      {code && <PairingCode code={code.code} expires={code.expires} onDone={() => (setCode(null), void load())} />}
      <ErrorText>{error}</ErrorText>
      <Card>
        {devices.map((d) => (
          <Row key={d.id} icon="devices" title={d.current ? `${d.name} (this one)` : d.name} description={`Paired ${day(d.added)} · last used ${day(d.seen)}`}>
            <Button size="sm" busy={busy === d.id} onClick={() => void remove(d)}>
              Remove
            </Button>
          </Row>
        ))}
      </Card>
      <p className="text-xs leading-relaxed text-ink-3">A removed device needs a new code to open the app again.</p>
    </Page>
  );
}

function PairingCode({ code, expires, onDone }: { code: string; expires: string; onDone: () => void }) {
  const { copied, copy } = useCopy();
  const link = `${location.origin}/?pair=${code}`;
  const minutes = Math.max(1, Math.round((Date.parse(expires) - Date.now()) / 60_000));
  return (
    <div className="flex animate-fade-in flex-col items-center gap-3 rounded-xl bg-card px-4 py-5 text-center ring-1 ring-line ring-inset">
      <p className="text-[13px] text-ink-2">On the other device, open Weilo Agents and type</p>
      <p className="font-mono text-[26px] font-semibold tracking-[0.2em]">{code}</p>
      <p className="text-xs leading-relaxed text-ink-3">It works once, for {minutes} minutes. On a phone, open your Tailscale address first.</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void copy(link)}>
          <Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy link"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
