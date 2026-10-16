import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Agent } from "../../api/agents";
import { listCommands, type Outgoing } from "../../api/chat";
import { messageOf, RequestError } from "../../api/http";
import type { Model, Provider } from "../../api/providers";
import { Avatar } from "../../components/ui/Avatar";
import { Button, IconButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Notice } from "../../components/ui/Notice";
import { Tag } from "../../components/ui/Tag";
import { TopBar } from "../../components/ui/TopBar";
import { useFollowBottom } from "../../lib/useFollowBottom";
import { useMedia } from "../../lib/useMedia";
import { read, write, KEYS } from "../../lib/storage";
import { avatarOf } from "../agents/avatars";
import { Composer, type Draft } from "./Composer";
import { ModelMenu } from "./ModelMenu";
import { fixesFor, Problem, type Fix } from "./Problem";
import { useNotifyOffer } from "./useNotifyOffer";
import { EmptyChat } from "./EmptyChat";
import type { Shortcut } from "./CommandMenu";
import { ContextMeter } from "./ContextMeter";
import { FindBar } from "./FindBar";
import { NO_REPLY, type Message } from "./conversation";
import { LoadingChat, MessageList } from "./MessageList";
import { useFind } from "./useFind";
import { useChat } from "./useChat";
import { BrowserPanel } from "../browser/BrowserPanel";
import { RoutinesPanel } from "../routines/RoutinesPanel";
import { Modal } from "../../components/ui/Modal";
import { PreviewProvider } from "../files/PreviewContext";

interface Props {
  agent: Agent;
  models?: Model[];
  providers: Provider[];
  onBack: () => void;
  find?: { query: string; at: number } | null;
  onEdit: () => void;
  /** Edit agent, opened at its daily limit. */
  onEditLimits: () => void;
  onActivity: () => void;
  onLive: (live: { busy: boolean; doing: string | null } | null) => void;
  onOpenSettings: () => void;
  onOpenNotifications: () => void;
}

const TOP_PX = 400;

export function ChatView({ agent, models, providers, find, onBack, onEdit, onEditLimits, onActivity, onLive, onOpenSettings, onOpenNotifications }: Props) {
  const hasProvider = providers.some((p) => p.connected);
  const chat = useChat(agent.id);
  const notify = useNotifyOffer(chat.busy);
  useEffect(() => onLive({ busy: chat.busy, doing: chat.doing }), [chat.busy, chat.doing]);
  useEffect(() => () => onLive(null), []);
  const wide = useMedia("(min-width: 1024px)");
  const [sidebar, setSidebar] = useState(() => read(KEYS.sidebar) !== "0");
  const [sheet, setSheet] = useState(false);
  const sideOpen = wide ? sidebar : sheet;
  const toggleSide = () => (wide ? (write(KEYS.sidebar, sidebar ? "0" : "1"), setSidebar(!sidebar)) : setSheet(!sheet));
  const routinesChanged = chat.messages.filter((m) => m.kind === "note").length;
  const scroller = useFollowBottom([chat.live, chat.asking]);
  const { away, unseen, toBottom } = scroller;

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
  const [finding, setFinding] = useState(!!find);
  const [query, setQuery] = useState(find?.query ?? "");
  useEffect(() => {
    if (find) (setFinding(true), setQuery(find.query));
  }, [find]);
  const first = chat.messages.find((m) => m.at !== null)?.at ?? 0;
  const loadingFor = !!find && chat.more && first > find.at;
  useEffect(() => {
    if (loadingFor && !chat.loadingEarlier) void chat.loadEarlier();
  }, [loadingFor, chat.loadingEarlier]);
  const found = useFind(scroller.box, finding ? query : "", [chat.messages, chat.ready], loadingFor ? null : find);
  const closeFind = () => (setFinding(false), setQuery(""));

  // plain: a problem that is not about a message (summarizing, a queued message, a model change), so no fixes.
  const [replyError, setReplyErrorOf] = useState<{ message: string; status?: number; plain?: boolean } | null>(null);
  const setReplyError = (message: string | null, plain = false) => setReplyErrorOf(message === null ? null : { message, plain });
  const failed = (err: unknown, plain = false) => setReplyErrorOf({ message: messageOf(err), status: err instanceof RequestError ? err.status : undefined, plain });
  const send = (message: Outgoing) =>
    (setReplyError(null),
    chat.send(message).catch((err) => {
      failed(err);
      throw Object.assign(err instanceof Error ? err : new Error(messageOf(err)), { shown: true });
    }));
  // A send that failed is old news once the agent works again.
  useEffect(() => void (chat.busy && setReplyErrorOf(null)), [chat.busy]);
  const reply = (text: string) => void send({ text, images: [], files: [] }).catch(() => {});
  const retry = ({ text, images }: Draft) => void send({ text, images, files: [] }).catch(() => {});
  const [fill, setFill] = useState<Draft | null>(null);
  const put = (draft: Draft) => setFill({ ...draft });
  const lastMine = chat.messages.findLast((m): m is Message => m.kind === "message" && m.role === "human");
  const last = lastMine && { text: lastMine.text, images: lastMine.images };
  const modelMenu = (button: boolean) => <ModelMenu agent={agent} models={models} providers={providers} busy={chat.busy} button={button} onChanged={() => (setReplyError(null), onActivity())} onError={(message) => setReplyError(message, true)} />;
  const problem = (message: string, fixes: Fix[], tone?: "alert" | "info") => (
    <Problem message={message} fixes={fixes} tone={tone} onRetry={last && !chat.busy ? () => (setReplyError(null), retry(last)) : undefined} modelPicker={modelMenu(true)} onProviders={onOpenSettings} onLimit={onEditLimits} />
  );
  const unqueue = (q: Parameters<typeof chat.unqueue>[0]) =>
    chat.unqueue(q).catch((err) => {
      failed(err, true);
      throw err;
    });
  const fresh = chat.ready && !chat.more && !chat.busy && !chat.messages.length && !chat.queued.length;

  const dock = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setRoom((entry.target as HTMLElement).offsetHeight));
    observer.observe(dock.current!);
    return () => observer.disconnect();
  }, []);

  const [skills, setSkills] = useState<Shortcut[]>([]);
  useEffect(() => {
    listCommands(agent.id).then(
      (commands) => setSkills(commands.map((c) => ({ label: c.name, description: c.description, insert: `/skill:${c.name} `, icon: "sparkle", group: "Skills" }))),
      () => setSkills([]),
    );
  }, [agent.id, agent.skills.join()]);
  const shortcuts = [{ label: "compact", description: "Summarize the conversation now. Add what to keep.", insert: "/compact ", icon: "sparkle", group: "Commands" } as Shortcut, { label: "reload", description: "Read the agent's skills, instructions and notes again.", insert: "/reload", icon: "sparkle", group: "Commands" } as Shortcut, ...skills, ...agent.plugins.map((name): Shortcut => ({ label: name, description: "Plugin", insert: `Use the ${name} plugin to `, icon: "puzzle", group: "Plugins" }))];

  return (
    <PreviewProvider agent={agent.id}>
    <div className="flex h-full min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onBack={onBack}
          leading={<Avatar spec={avatarOf(agent)} size={32} working={chat.busy} doing={chat.doing} />}
          title={agent.name}
          subtitle={<>{agent.isolated && <Tag>Isolated</Tag>}{modelMenu(false)}</>}
          onTitle={onEdit}
          actions={<><IconButton icon="search" label="Find in this chat" aria-pressed={finding} className={finding ? "bg-select text-ink" : ""} onClick={() => (finding ? closeFind() : setFinding(true))} /><IconButton icon="panel" label={sideOpen ? "Hide browser and routines" : "Show browser and routines"} aria-pressed={sideOpen} className={sideOpen ? "bg-select text-ink" : ""} onClick={toggleSide} /></>}
        />
        {finding && <FindBar query={query} onQuery={setQuery} count={found.count} current={found.current} onNext={found.next} onPrevious={found.previous} onClose={closeFind} />}
        <div className="relative min-h-0 flex-1">
          <div ref={scroller.box} style={{ paddingBottom: room }} className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-5">
              {chat.more && <p className="flex items-center justify-center gap-2 pb-4 text-xs text-ink-3">{chat.loadingEarlier ? <><Icon name="spinner" size={12} /> Loading earlier messages…</> : <button type="button" onClick={() => void chat.loadEarlier()} className="underline">Load earlier messages</button>}</p>}
              {!chat.ready ? <LoadingChat /> : fresh ? <EmptyChat name={agent.name} avatar={avatarOf(agent)} shortcuts={shortcuts} onPick={(text) => put({ text, images: [] })} /> : <MessageList messages={chat.messages} busy={chat.busy} asking={chat.asking} onAnswer={chat.answer} onReply={reply} onRetry={retry} onEdit={put} queued={chat.queued} onUnqueue={unqueue} note={chat.note === NO_REPLY ? problem("No reply came. Send your message again, or try another model.", ["retry", "model"], "info") : chat.note} />}
            </div>
          </div>
          <div ref={dock} className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-page from-55% to-transparent pt-8">
            <div className="pointer-events-auto mx-auto flex w-full max-w-3xl flex-col gap-2 px-3 pb-[max(0.75rem,var(--safe-bottom))] sm:px-4 sm:pb-[max(1rem,var(--safe-bottom))]">
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
              {notify.offer && (
                <Notice
                  title="Get a notification when an agent finishes?"
                  action={
                    <span className="flex shrink-0 gap-1.5">
                      <Button size="sm" variant="ghost" onClick={notify.dismiss}>Not now</Button>
                      <Button size="sm" variant="primary" onClick={() => void notify.accept()}>Turn on</Button>
                    </span>
                  }
                >
                  {notify.error ?? <>{agent.name} finished while you were away. <button type="button" onClick={onOpenNotifications} className="underline underline-offset-2">Settings</button></>}
                </Notice>
              )}
              {replyError && problem(replyError.message, replyError.plain ? [] : fixesFor(replyError.message, replyError.status))}
              {chat.error &&
                (chat.stopped ? (
                  <Notice tone="alert" action={<Button size="sm" onClick={chat.retry}>Try again</Button>}>
                    {chat.error}
                  </Notice>
                ) : (
                  problem(chat.error, fixesFor(chat.error))
                ))}
              <Composer
                agentId={agent.id}
                fill={fill}
                last={last}
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
                meter={chat.context && <ContextMeter context={chat.context} compacting={chat.compacting} busy={chat.busy} onCompact={() => void chat.compact().catch((err) => failed(err, true))} />}
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
          <div className="-mx-4 -mt-4 -mb-2">
            <Side agent={agent} routinesChanged={routinesChanged} onTaken={onActivity} />
          </div>
        </Modal>
      )}
    </div>
    </PreviewProvider>
  );
}

const Side = ({ agent, routinesChanged, onTaken }: { agent: Agent; routinesChanged: number; onTaken: () => void }) => (
  <>
    <BrowserPanel agentId={agent.id} agentName={agent.name} off={agent.disabled.includes("browser")} taken={!!agent.taken} open={!!agent.browserOpen} onTaken={onTaken} />
    <RoutinesPanel agentId={agent.id} agentName={agent.name} off={agent.disabled.includes("routines")} changed={routinesChanged} />
  </>
);
