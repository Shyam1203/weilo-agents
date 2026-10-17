import { useCallback, useEffect, useState } from "react";
import { listActions, type Action } from "../../api/actions";
import { messageOf } from "../../api/http";

export function useActions(agentId: string, changed: number) {
  const [actions, setActions] = useState<Action[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => listActions(agentId).then((list) => (setActions(list), setError(null)), (err) => setError(messageOf(err))), [agentId]);
  useEffect(() => void refresh(), [refresh, changed]);
  return { actions, error, refresh };
}
