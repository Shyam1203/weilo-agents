// Throwaway harness for the OpenUI spike: replays a show tool call as pi's RPC streams it.
import { useEffect, useMemo, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "./styles/index.css";
import { empty, itemsOf, reduce, type PiEvent } from "./features/chat/conversation";
import { ShowBlocks } from "./features/chat/ShowBlocks";

const SOURCE = `root = Stack([numbers, signup])
numbers = Card([Stack([Metric("Open tickets", 42, "-8 this week"), Metric("Median reply", "1h 12m"), Metric("CSAT", "94%")], "row"), Chart("bar", ["Mon", "Tue", "Wed", "Thu", "Fri"], [12, 19, 9, 15, 7])], "Support this week")
signup = Card([Form("escalate", [Field("Ticket", Input("ticket", "e.g. #4821", "text", {required: true})), Field("Team", Select("team", ["Billing", "Infra", "Product"], "Choose a team", {required: true})), Field("Note", TextArea("note", "Anything the team should know"))], Buttons([Button("Escalate"), Button("Cancel", "secondary")]))], "Escalate a ticket")`;

const ARGS = JSON.stringify({ blocks: [{ type: "text", text: "Here is the week, and a form to escalate a ticket." }, { type: "openui", source: SOURCE }] });
const params = new URLSearchParams(location.search);
const stopAt = Number(params.get("stop") ?? 1);

function events(): PiEvent[] {
  const call = { type: "toolCall", id: "t1", name: "show", arguments: JSON.parse(ARGS) };
  const chunks = ARGS.slice(0, Math.floor(ARGS.length * stopAt)).match(/[\s\S]{1,14}/g) ?? [];
  const list: PiEvent[] = [
    { type: "history", messages: [], busy: false },
    { type: "agent_start" },
    { type: "message_start", message: { role: "assistant", content: [], timestamp: 1 } },
    { type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, id: "t1", toolName: "show" } } as PiEvent,
    ...chunks.map((delta) => ({ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta } }) as PiEvent),
  ];
  if (stopAt < 1) return list;
  return [...list, { type: "message_update", assistantMessageEvent: { type: "toolcall_end", contentIndex: 0, toolCall: call } } as PiEvent, { type: "message_end", message: { role: "assistant", content: [call], timestamp: 1 } }, { type: "agent_settled" }];
}

function Spike() {
  const [chat, dispatch] = useReducer(reduce, empty);
  const [reply, setReply] = useState("");
  const [run, setRun] = useState(0);
  useEffect(() => {
    const all = events();
    let i = 0;
    const timer = setInterval(() => (i < all.length ? dispatch(all[i++]) : clearInterval(timer)), Number(params.get("ms") ?? 25));
    return () => clearInterval(timer);
  }, [run]);
  const items = useMemo(() => itemsOf(chat), [chat]);
  const show = items.find((m) => m.kind === "show");
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center gap-3 text-xs text-ink-3">
        <button className="underline" onClick={() => (setReply(""), setRun((n) => n + 1))}>Replay stream</button>
        <span>{chat.busy ? "streaming…" : "done"}</span>
      </div>
      {show?.kind === "show" && <ShowBlocks blocks={show.blocks} streaming={show.streaming} onReply={reply ? undefined : setReply} chosen={reply || undefined} />}
      {reply && <pre className="rounded-xl bg-select p-3 text-[13px] whitespace-pre-wrap">Reply sent to the agent:{"\n"}{reply}</pre>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Spike />);
