import { useEffect, useState } from "react";
import type { Agent } from "../../api/agents";
import { messageOf } from "../../api/http";
import { getPush, setMuted, type PushStatus } from "../../api/push";
import { Avatar } from "../../components/ui/Avatar";
import { ErrorText } from "../../components/ui/Field";
import { Loading } from "../../components/ui/List";
import { Notice } from "../../components/ui/Notice";
import { Card, Page, Row } from "../../components/ui/Row";
import { Switch } from "../../components/ui/Switch";
import { thisDevice, turnOff, turnOn, unsupported } from "../../lib/push";
import { useAction } from "../../lib/useAction";
import { avatarOf } from "../agents/avatars";

export function NotificationsPage({ agents, section }: { agents: Agent[]; section?: boolean }) {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { error, run } = useAction();
  const load = () => getPush().then(setStatus, (e) => setLoadError(messageOf(e)));
  useEffect(() => void load(), []);
  if (!status) return loadError ? <ErrorText>{loadError}</ErrorText> : <Loading />;

  const why = unsupported();
  const mine = thisDevice();
  const on = !!mine && status.devices.includes(mine);
  const toggle = (next: boolean) => run("device", async () => (next ? await turnOn(status.publicKey) : await turnOff(), await load()));
  const mute = (id: string, sends: boolean) => {
    const muted = sends ? status.muted.filter((m) => m !== id) : [...status.muted, id];
    setStatus({ ...status, muted });
    void run("mute", () => setMuted(muted));
  };

  return (
    <Page section={section} title="Notifications" description="When an agent replies or needs you.">
      {why ? (
        <Notice>{why}</Notice>
      ) : (
        <Card>
          <Row icon="bell" title="This device" description={on ? "Notifications are on." : "Turn on to get notifications here."}>
            <Switch label="Notifications on this device" checked={on} onChange={(next) => void toggle(next)} />
          </Row>
        </Card>
      )}
      <ErrorText>{error}</ErrorText>
      {status.devices.length > 0 && agents.length > 0 && (
        <Card>
          {agents.map((a) => (
            <Row key={a.id} title={<span className="flex items-center gap-2.5"><Avatar spec={avatarOf(a)} size={22} />{a.name}</span>}>
              <Switch label={`Notifications from ${a.name}`} checked={!status.muted.includes(a.id)} onChange={(sends) => mute(a.id, sends)} />
            </Row>
          ))}
        </Card>
      )}
      <p className="text-xs leading-relaxed text-ink-3">Notifications travel through your browser's push service (Google, Apple, Mozilla or Microsoft), encrypted so only your device can read them.</p>
    </Page>
  );
}
