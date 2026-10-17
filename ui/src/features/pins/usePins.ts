import { useCallback, useEffect, useState } from "react";
import { messageOf } from "../../api/http";
import { listPins, type Pin } from "../../api/pins";
import { read, write } from "../../lib/storage";

const seenKey = (agentId: string) => `weilo.pinsSeen.${agentId}`;

export function usePins(agentId: string, changed: number) {
  const [pins, setPins] = useState<Pin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState(() => Number(read(seenKey(agentId)) ?? 0));
  const refresh = useCallback(() => listPins(agentId).then((list) => (setPins(list), setError(null)), (err) => setError(messageOf(err))), [agentId]);
  useEffect(() => void refresh(), [refresh, changed]);
  useEffect(() => setSeen(Number(read(seenKey(agentId)) ?? 0)), [agentId]);
  const fresh = !!pins?.some((p) => p.changedAt > seen);
  const look = useCallback(() => {
    const now = Date.now();
    write(seenKey(agentId), String(now));
    setSeen(now);
  }, [agentId]);
  return { pins, setPins, error, refresh, fresh, look };
}
