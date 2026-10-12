import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Agent } from "../../api/agents";
import { listCommands, type Outgoing } from "../../api/chat";
import { messageOf } from "../../api/http";
import type { Model } from "../../api/providers";
import { Avatar } from "../../components/ui/Avatar";
import { Button, IconButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
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
import { FindBar } from "./FindBar";
import { MessageList } from "./MessageList";
import { useFind } from "./useFind";
import { useChat } from "./useChat";
import { BrowserPanel } from "../browser/BrowserPanel";
import { RoutinesPanel } from "../routines/RoutinesPanel";
import { Modal } from "../../components/ui/Modal";
import { PreviewProvider } from "../files/PreviewContext";

interface Props {
  agent: Agent;
  models?: Model[];
  /** A provider is connected, so there is a model to talk to. */
  hasProvider: boolean;
  onBack: () => void;
  /** Words to find as the chat opens, near the message at `at` (s). */
  find?: { query: string; at: number } | null;
  onEdit: () => void;
  /** A run started, moved on or ended: the agent list shows what it is doing, and its newest message. */
  onActivity: () => void;
  /** What the agent is doing, live from the chat: the agent list shows the same, in step with it. Null again when the chat closes. */
  onLive: (live: { busy: boolean; doing: string | null } | null) => void;
  onOpenSettings: () => void;
}

/** How near the top (px) the reader must scroll for earlier messages to load. */
const TOP_PX = 400;

/** One agent's chat. Give it a `key` of the agent's id. */
export function ChatView({ agent, models, hasProvider, find, onBack, onEdit, onActivity, onLive, onOpenSettings }: Props) {
  const chat = useChat(agent.id, onActivity);
  useEffect(() => onLive({ busy: chat.busy, doing: chat.doing }), [chat.busy, chat.doing]);
  useEffect(() => () => onLive(null), []);
  // The browser and the routines: beside the chat on a wide screen (you can hide them), over it on a narrow one.
  const wide = useMedia("(min-width: 1024px)");
  const [sidebar, setSidebar] = useState(() => read(KEYS.sidebar) !== "0");
  const [sheet, setSheet] = useState(false);
  const sideOpen = wide ? sidebar : sheet;
  const toggleSide = () => (wide ? (write(KEYS.sidebar, sidebar ? "0" : "1"), setSidebar(!sidebar)) : setSheet(!sheet));
  const routinesChanged = chat.messages.filter((m) => m.kind === "note").length;
  // Only what pi sends moves the view down: earlier messages load above without counting as new.
  const scroller = useFollowBottom([chat.live, chat.asking]);
  const { away, unseen, toBottom } = scroller;

  // Messages pi summarized away load as the reader nears the top (or at once, when the chat does not fill the view).
  const load = useRef(chat.loadEarlier);
  load.current = chat.loadEarlier;
  useEffect(() => {
    const el = scroller.box.current;
    if (!el || !chat.more) return;
    const check = () => el.clientHeight && el.scrollTop < TOP_PX && void load.current();
    check();
    el.addEventListener("scroll", check, { passive: true });
    return () => el.removeEventListener("scroll", check);
  }, [chat.more, chat.loadingEarlier, chat.ready]);
  // They load above what is on screen, which stays where it is: the distance from the bottom is kept.
  const fromBottom = useRef(0);
  const earliest = chat.messages[0]?.id;
  const before = useRef(earliest);
  if (before.current !== earliest && scroller.box.current) {
    const el = scroller.box.current;
    fromBottom.current = el.scrollHeight - el.scrollTop;
  }
  useLayoutEffect(() => {
    const el = scroller.box.current;
    if (el && before.current !== earliest && before.current !== undefined && fromBottom.current) el.scrollTop = el.scrollHeight - fromBottom.current;
    before.current = earliest;
    fromBottom.current = 0;
  }, [earliest]);
  // Finding words in this chat: open with a search's words, or from the header's button.
  const [finding, setFinding] = useState(!!find);
  const [query, setQuery] = useState(find?.query ?? "");
  useEffect(() => {
    if (find) (setFinding(true), setQuery(find.query));
  }, [find]);
  // A search result older than what is loaded: earlier messages load until it is there, then the view goes to it.
  const first = chat.messages.find((m) => m.at !== null)?.at ?? 0;
  const loadingFor = !!find && chat.more && first > find.at;
  useEffect(() => {
    if (loadingFor && !chat.loadingEarlier) void chat.loadEarlier();
  }, [loadingFor, chat.loadingEarlier]);
  const found = useFind(scroller.box, finding ? query : "", [chat.messages, chat.ready], loadingFor ? null : find);
  const closeFind = () => (setFinding(false), setQuery(""));

  // A message sent from the message box shows its own error. A reply from a button, card or page has no box: its error shows above it.
  const [replyError, setReplyError] = useState<string | null>(null);
  const send = (message: Outgoing) => (setReplyError(null), chat.send(message));
  const reply = (text: string) => void send({ text, images: [], files: [] }).catch((err) => setReplyError(messageOf(err)));

  // The message box floats over the chat; the chat leaves room for it, whatever its height.
  const dock = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setRoom((entry.target as HTMLElement).offsetHeight));
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
    <PreviewProvider>
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onBack={onBack}
          leading={<Avatar spec={avatarOf(agent)} size={32} working={chat.busy} doing={chat.doing} />}
          title={agent.name}
          subtitle={agent.model ? (models?.find((m) => m.id === agent.model)?.name ?? agent.model) : "Choose a model"}
          onTitle={onEdit}
          actions={<><IconButton icon="search" label="Find in this chat" aria-pressed={finding} className={finding ? "bg-select text-ink" : ""} onClick={() => (finding ? closeFind() : setFinding(true))} /><IconButton icon="globe" label={sideOpen ? "Hide the browser" : "Show the browser"} aria-pressed={sideOpen} className={sideOpen ? "bg-select text-ink" : ""} onClick={toggleSide} /></>}
        />
        {finding && <FindBar query={query} onQuery={setQuery} count={found.count} current={found.current} onNext={found.next} onPrevious={found.previous} onClose={closeFind} />}
        <div className="relative min-h-0 flex-1">
          <div ref={scroller.box} style={{ paddingBottom: room }} className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-5">
              {chat.more && <p className="flex items-center justify-center gap-2 pb-4 text-xs text-ink-3">{chat.loadingEarlier ? <><Icon name="spinner" size={12} /> Loading earlier messages…</> : <button type="button" onClick={() => void chat.loadEarlier()} className="underline">Load earlier messages</button>}</p>}
              {chat.ready ? <MessageList messages={chat.messages} busy={chat.busy} asking={chat.asking} onAnswer={chat.answer} onReply={reply} queued={chat.queued} note={chat.note} /> : <Loading />}
            </div>
          </div>
          <div ref={dock} className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-page from-55% to-transparent pt-8">
            <div className="pointer-events-auto mx-auto flex w-full max-w-3xl flex-col gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
              {/* Scrolled up: a way back down to the newest, which says when something new came meanwhile. */}
              {away && (
                <button
                  type="button"
                  onClick={toBottom}
                  aria-label={unseen ? "New messages: scroll to the newest" : "Scroll to the newest"}
                  className="mx-auto flex animate-fade-in items-center gap-1.5 rounded-full bg-raised px-3 py-1.5 text-[13px] font-medium text-ink shadow-pop ring-1 ring-line"
                >
                  <Icon name="arrowDown" size={15} />
                  {unseen && "New messages"}
                </button>
              )}
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
                doing={chat.doing}
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
    </PreviewProvider>
  );
}

// The browser and the routines of one agent. `onTaken`: you took the browser over or gave it back.
const Side = ({ agent, routinesChanged, onTaken }: { agent: Agent; routinesChanged: number; onTaken: () => void }) => (
  <>
    <BrowserPanel agentId={agent.id} agentName={agent.name} off={agent.disabled.includes("browser")} onTaken={onTaken} />
    <RoutinesPanel agentId={agent.id} agentName={agent.name} off={agent.disabled.includes("routines")} changed={routinesChanged} />
  </>
);
