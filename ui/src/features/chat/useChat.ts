import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { abort, answerAsk, compactChat, eventsUrl, getContext, getEarlier, reloadAgent, send, unqueue, type Context, type Outgoing } from "../../api/chat";
import { empty, failureOf, itemsOf, noteOf, reduce, type PiEvent, type PiMessage, type Queued } from "./conversation";

const RELOADED = "Reloaded: skills, instructions and notes were read again.";
const MEASURE = ["history", "agent_settled", "compaction_end"];

export function useChat(agentId: string) {
  const [chat, dispatch] = useReducer(reduce, empty);
  const [attempt, setAttempt] = useState(0);
  const [context, setContext] = useState<Context | null>(null);
  const [compacting, setCompacting] = useState(false);
  const [doing, setDoing] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [actionsChanged, setActionsChanged] = useState(0);
  const [pinsChanged, setPinsChanged] = useState(0);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const loading = useRef(false);
  const loadEarlier = async () => {
    if (loading.current || !chat.more) return;
    loading.current = true;
    setLoadingEarlier(true);
    try {
      const page = await getEarlier<PiMessage>(agentId, chat.earlier.length);
      dispatch({ type: "earlier", messages: page.messages, more: page.more });
    } catch {
    } finally {
      loading.current = false;
      setLoadingEarlier(false);
    }
  };
  const reloading = useRef(false);

  useEffect(() => {
    const source = new EventSource(eventsUrl(agentId));
    source.onmessage = (m) => {
      const event: PiEvent = JSON.parse(m.data);
      if (event.type === "exit" && event.error) source.close();
      dispatch(event);
      if (event.type === "compaction_start") setCompacting(true);
      if (event.type === "compaction_end") (setCompacting(false), event.result && setStatus("The conversation was summarized."));
      if (event.type === "agent_start") setStatus(null);
      if (event.type === "actions_changed") setActionsChanged((n) => n + 1);
      if (event.type === "pins_changed") setPinsChanged((n) => n + 1);
      if (event.type === "tool_execution_start") setDoing(event.toolName ?? null);
      if (event.type === "tool_execution_end" || event.type === "agent_settled" || event.type === "exit") setDoing(null);
      if (event.type === "agent_settled" && reloading.current) (reloading.current = false, setStatus(RELOADED));
      if (MEASURE.includes(event.type)) void getContext(agentId).then(setContext, () => {});
    };
    return () => source.close();
  }, [agentId, attempt]);

  const compact = async (instructions?: string) => {
    setCompacting(true);
    try {
      setContext(await compactChat(agentId, instructions));
    } finally {
      setCompacting(false);
    }
  };

  return {
    context,
    actionsChanged,
    pinsChanged,
    compacting,
    compact,
    ready: chat.ready,
    stopped: !!chat.exit,
    busy: chat.busy,
    doing,
    asking: chat.asking,
    queued: chat.queued,
    note: status ?? noteOf(chat),
    messages: useMemo(() => itemsOf(chat), [chat]),
    live: chat.messages,
    more: chat.more,
    loadingEarlier,
    loadEarlier,
    error: chat.exit ?? failureOf(chat) ?? null,
    retry: () => setAttempt((n) => n + 1),
    send: (message: Outgoing) => {
      const command = !message.images.length && !message.files.length && /^\/(compact|reload)(?:\s+([\s\S]*))?$/.exec(message.text.trim());
      if (!command) return send(agentId, message);
      if (command[1] === "compact") return compact(command[2]);
      return reloadAgent(agentId).then(() => (reloading.current = chat.busy, setStatus(chat.busy ? "The agent reloads when it finishes." : RELOADED)));
    },
    answer: (value?: string) => answerAsk(agentId, chat.asking!.id, value),
    stop: () => abort(agentId).catch(() => {}),
    unqueue: (queued: Queued) => unqueue(agentId, queued.text, queued.when),
  };
}
