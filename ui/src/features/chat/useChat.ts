import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { abort, answerAsk, compactChat, eventsUrl, getContext, reloadAgent, send, type Context, type Outgoing } from "../../api/chat";
import { empty, failureOf, itemsOf, noteOf, reduce, type PiEvent } from "./conversation";

const ACTIVITY = ["agent_start", "agent_settled", "tool_execution_start", "tool_execution_end"];
// After these the context has changed: measure it again.
const MEASURE = ["history", "agent_settled", "compaction_end"];

/** One agent's conversation, live from the server; `onActivity` runs when a run starts or ends, and as it moves from one tool to the next (the agent list shows what it is doing). Give it a `key` of the agent's id. */
export function useChat(agentId: string, onActivity: () => void) {
  const [chat, dispatch] = useReducer(reduce, empty);
  const [attempt, setAttempt] = useState(0);
  const [context, setContext] = useState<Context | null>(null);
  const [compacting, setCompacting] = useState(false);
  // What /compact, /reload or an automatic summary just did, in a line under the chat; it goes when the agent starts again.
  const [status, setStatus] = useState<string | null>(null);
  const activity = useRef(onActivity);
  activity.current = onActivity;

  // The stream ends when pi does; the browser reconnects to the next pi by itself, except after a failure.
  useEffect(() => {
    const source = new EventSource(eventsUrl(agentId));
    source.onmessage = (m) => {
      const event: PiEvent = JSON.parse(m.data);
      if (event.type === "exit" && event.error) source.close();
      dispatch(event);
      if (event.type === "compaction_start") setCompacting(true);
      if (event.type === "compaction_end") (setCompacting(false), event.result && setStatus("The conversation was summarized."));
      if (event.type === "agent_start") setStatus(null);
      if (MEASURE.includes(event.type)) void getContext(agentId).then(setContext, () => {});
      if (ACTIVITY.includes(event.type)) activity.current();
    };
    return () => source.close();
  }, [agentId, attempt]);

  // Summarizes now (pi's /compact); the error, if any, is for the caller to show.
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
    compacting,
    compact,
    ready: chat.ready,
    stopped: !!chat.exit,
    busy: chat.busy,
    asking: chat.asking,
    queued: chat.queued,
    note: status ?? noteOf(chat),
    messages: useMemo(() => itemsOf(chat), [chat]),
    error: chat.exit ?? failureOf(chat) ?? null,
    retry: () => setAttempt((n) => n + 1),
    // "/compact" (and what to keep after it) and "/reload" are commands of the chat: pi's own prompt does not take them.
    send: (message: Outgoing) => {
      const command = !message.images.length && !message.files.length && /^\/(compact|reload)(?:\s+([\s\S]*))?$/.exec(message.text.trim());
      if (!command) return send(agentId, message);
      if (command[1] === "compact") return compact(command[2]);
      return reloadAgent(agentId).then(() => setStatus(chat.busy ? "The agent reloads when it finishes." : "Reloaded: skills, instructions and notes were read again."));
    },
    /** Answers the question the agent waits on; no value skips it. */
    answer: (value?: string) => answerAsk(agentId, chat.asking!.id, value),
    stop: () => abort(agentId).catch(() => {}),
  };
}
