import { useEffect, useRef, useState } from "react";
import type { Agent } from "../../api/agents";
import { listCommands, type Outgoing } from "../../api/chat";
import { messageOf } from "../../api/http";
import type { Model } from "../../api/providers";
import { Avatar } from "../../components/ui/Avatar";
import { Button, IconButton } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Notice";
import { TopBar } from "../../components/ui/TopBar";
import { Loading } from "../../components/ui/List";
import { useFollowBottom } from "../../lib/useFollowBottom";
import { useMedia } from "../../lib/useMedia";
import { read, write, KEYS } from "../../lib/storage";
import { avatarOf } from "../agents/avatars";
import { Composer } from "./Composer";
import type { Shortcut } from "./CommandMenu";
import { ContextMeter } from "./ContextMeter";
import { MessageList } from "./MessageList";
import { useChat } from "./useChat";
import { BrowserPanel } from "../browser/BrowserPanel";
import { RoutinesPanel } from "../routines/RoutinesPanel";
import { Modal } from "../../components/ui/Modal";

interface Props {
  agent: Agent;
  models?: Model[];
  /** A provider is connected, so there is a model to talk to. */
  hasProvider: boolean;
  onBack: () => void;
  onEdit: () => void;
  /** A run started, moved on or ended: the agent list shows what it is doing, and its newest message. */
  onActivity: () => void;
  onOpenSettings: () => void;
}

/** One agent's chat. Give it a `key` of the agent's id. */
export function ChatView({ agent, models, hasProvider, onBack, onEdit, onActivity, onOpenSettings }: Props) {
  const chat = useChat(agent.id, onActivity);
  // The browser and the routines: beside the chat on a wide screen (you can hide them), over it on a narrow one.
  const wide = useMedia("(min-width: 1024px)");
  const [sidebar, setSidebar] = useState(() => read(KEYS.sidebar) !== "0");
  const [sheet, setSheet] = useState(false);
  const sideOpen = wide ? sidebar : sheet;
  const toggleSide = () => (wide ? (write(KEYS.sidebar, sidebar ? "0" : "1"), setSidebar(!sidebar)) : setSheet(!sheet));
  const routinesChanged = chat.messages.filter((m) => m.kind === "note").length;
  const scroller = useFollowBottom([chat.messages, chat.asking]);

  // A message sent from the message box shows its own error. A reply from a button, card or page has no box: its error shows above it.
  const [replyError, setReplyError] = useState<string | null>(null);
  const send = (message: Outgoing) => (setReplyError(null), chat.send(message));
  const reply = (text: string) => void send({ text, images: [], files: [] }).catch((err) => setReplyError(messageOf(err)));

  // The message box floats over the chat; the chat leaves room for it, whatever its height.
  const dock = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setRoom(entry.target.getBoundingClientRect().height));
    observer.observe(dock.current!);
    return () => observer.disconnect();
  }, []);

  // What typing "/" offers: the agent's skills (pi's own commands, asked of its pi) and its plugins.
  const [skills, setSkills] = useState<Shortcut[]>([]);
  useEffect(() => {
    listCommands(agent.id).then(
      (commands) => setSkills(commands.map((c) => ({ label: c.name, description: c.description, insert: `/skill:${c.name} `, icon: "sparkle", group: "Skills" }))),
      () => setSkills([]),
    );
  }, [agent.id, agent.skills.join()]);
  const shortcuts = [{ label: "compact", description: "Summarize the conversation now. Add what to keep.", insert: "/compact ", icon: "sparkle", group: "Commands" } as Shortcut, { label: "reload", description: "Read the agent's skills, instructions and notes again.", insert: "/reload", icon: "sparkle", group: "Commands" } as Shortcut, ...skills, ...agent.plugins.map((name): Shortcut => ({ label: name, description: "Plugin", insert: `Use the ${name} plugin to `, icon: "puzzle", group: "Plugins" }))];

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onBack={onBack}
          leading={<Avatar spec={avatarOf(agent)} size={32} working={chat.busy} />}
          title={agent.name}
          subtitle={agent.model ? (models?.find((m) => m.id === agent.model)?.name ?? agent.model) : "Choose a model"}
          onTitle={onEdit}
          actions={<IconButton icon="globe" label={sideOpen ? "Hide the browser" : "Show the browser"} aria-pressed={sideOpen} className={sideOpen ? "bg-select text-ink" : ""} onClick={toggleSide} />}
        />
        <div className="relative min-h-0 flex-1">
          <div ref={scroller} style={{ paddingBottom: room }} className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-5">{chat.ready ? <MessageList messages={chat.messages} busy={chat.busy} asking={chat.asking} onAnswer={chat.answer} onReply={reply} note={chat.note} /> : <Loading />}</div>
          </div>
          <div ref={dock} className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-page from-55% to-transparent pt-8">
            <div className="pointer-events-auto mx-auto flex w-full max-w-3xl flex-col gap-2 px-3 pb-3 sm:px-4 sm:pb-4">
              {!hasProvider && (
                <Notice title="Add a provider to send messages." action={<Button size="sm" onClick={onOpenSettings}>Add provider</Button>}>
                  Weilo Agents needs an API key to use a model.
                </Notice>
              )}
              {replyError && <Notice tone="alert">{replyError}</Notice>}
              {chat.error && (
                <Notice tone="alert" action={chat.stopped && <Button size="sm" onClick={chat.retry}>Try again</Button>}>
                  {chat.error}
                </Notice>
              )}
              <Composer
                onEdit={onEdit}
                shortcuts={shortcuts}
                to={agent.name}
                avatar={avatarOf(agent)}
                busy={chat.busy}
                waiting={!!chat.asking}
                onAnswer={chat.asking ? chat.answer : undefined}
                disabled={!hasProvider}
                onSend={send}
                onStop={chat.stop}
                meter={chat.context && <ContextMeter context={chat.context} compacting={chat.compacting} busy={chat.busy} onCompact={() => void chat.compact().catch((err) => setReplyError(messageOf(err)))} />}
              />
            </div>
          </div>
        </div>
      </div>
      {sideOpen && wide && (
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-line">
          <Side agent={agent} routinesChanged={routinesChanged} onTaken={onActivity} />
        </aside>
      )}
      {sideOpen && !wide && (
        <Modal title={agent.name} onClose={() => setSheet(false)} width="max-w-md">
          <Side agent={agent} routinesChanged={routinesChanged} onTaken={onActivity} />
        </Modal>
      )}
    </div>
  );
}

// The browser and the routines of one agent. `onTaken`: you took the browser over or gave it back.
const Side = ({ agent, routinesChanged, onTaken }: { agent: Agent; routinesChanged: number; onTaken: () => void }) => (
  <>
    <BrowserPanel agentId={agent.id} agentName={agent.name} off={agent.disabled.includes("browser")} onTaken={onTaken} />
    <RoutinesPanel agentId={agent.id} agentName={agent.name} off={agent.disabled.includes("routines")} changed={routinesChanged} />
  </>
);
