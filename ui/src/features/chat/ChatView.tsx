import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
import { Modal } from "../../components/ui/Modal";
import { PreviewProvider } from "../files/PreviewContext";
import { removeAction, runAction, type Action, type ActionRun } from "../../api/actions";
import { ActionResult } from "../actions/ActionResult";
import { ActionDetail } from "../actions/ActionDetail";
import { NewAction } from "../actions/NewAction";
import { ActionsPanel } from "../actions/ActionsPanel";
import { RunDialog } from "../actions/RunDialog";
import { useActions } from "../actions/useActions";

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

type Panel = "actions" | "browser";
const PANELS: Record<Panel, string> = { actions: "Actions", browser: "Browser" };
// Older versions kept "1" (open) or "0" (closed) here; open now means the actions panel.
const savedPanel = (): Panel | null => {
  const saved = read(KEYS.sidebar);
  return saved === "0" ? null : saved === "browser" ? "browser" : "actions";
};

export function ChatView({ agent, models, providers, find, onBack, onEdit, onEditLimits, onActivity, onLive, onOpenSettings, onOpenNotifications }: Props) {
  const hasProvider = providers.some((p) => p.connected);
  const chat = useChat(agent.id);
  const notify = useNotifyOffer(chat.busy);
  useEffect(() => onLive({ busy: chat.busy, doing: chat.doing }), [chat.busy, chat.doing]);
  useEffect(() => () => onLive(null), []);
  const wide = useMedia("(min-width: 1024px)");
  // One panel on the right at a time: on a wide screen it stays as you left it, on a narrow one it opens over the chat.
  const [docked, setDocked] = useState<Panel | null>(savedPanel);
  const [sheet, setSheet] = useState<Panel | null>(null);
  const panel = wide ? docked : sheet;
  const togglePanel = (which: Panel) => {
    const next = panel === which ? null : which;
    if (!wide) return setSheet(next);
    write(KEYS.sidebar, next ?? "0");
    setDocked(next);
  };
  const browserBusy = !!agent.browserOpen || !!agent.taken;
  // Read the actions again when the chat shows one was saved or changed, or one ran by itself.
  const acts = useActions(agent.id, chat.messages.filter((m) => m.kind === "note").length + chat.actionsChanged);
  const [pending, setPending] = useState<{ key: number; action: Action }[]>([]);
  const scroller = useFollowBottom([chat.live, chat.asking, pending, acts.actions]);
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
  const actionsOff = agent.disabled.includes("actions");
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [asked, setAsked] = useState<Action | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const go = async (action: Action, input: Record<string, string>) => {
    setAsked(null);
    setOpened(null);
    setSheet(null);
    const key = Date.now();
    // An instant action answers in the chat (kept with the action); an agent action goes to the chat as your message.
    if (action.kind === "script") setPending((list) => [...list, { key, action }]);
    setRunning((now) => new Set(now).add(action.id));
    try {
      await runAction(agent.id, action.id, input);
    } catch (err) {
      failed(err, action.kind === "script");
    } finally {
      await acts.refresh();
      setPending((list) => list.filter((p) => p.key !== key));
      setRunning((now) => new Set([...now].filter((id) => id !== action.id)));
    }
  };
  const start = (action: Action) => (setOpened(null), action.fields.length ? setAsked(action) : void go(action, {}));
  const remove = (action: Action) => removeAction(agent.id, action.id).then(() => (setOpened(null), acts.refresh()), (err) => failed(err, true));
  const actionsPanel = <ActionsPanel agentName={agent.name} off={actionsOff} actions={acts.actions} error={acts.error} running={running} onRun={start} onOpen={(a) => setOpened(a.id)} onNew={() => (setSheet(null), setMaking(true))} titled={wide} />;
  const openedAction = acts.actions?.find((a) => a.id === opened);
  // Instant actions' answers sit in the chat by their time; ones older than the messages loaded wait for "Load earlier".
  const since = chat.more ? (chat.messages.find((m) => m.at !== null)?.at ?? Infinity) : 0;
  const answer = (action: Action, run: ActionRun | undefined, latest: boolean) => (
    <ActionResult
      action={action}
      run={run}
      latest={latest}
      agentName={agent.name}
      onAgain={() => start(action)}
      onAsk={() => put({ text: `About "${action.title}" (it said: ${run?.text}): `, images: [] })}
      onFix={() => void send({ text: `My action "${action.title}" did not work: ${run?.text}\nLook at its script (action list), find what changed, test a fix with try, and save it with action update.`, images: [], files: [] }).catch(() => {})}
    />
  );
  const answers = [
    ...(acts.actions ?? []).flatMap((a) =>
      a.runs
        .filter((r) => !r.chat)
        .map((r, i) => ({ at: r.at / 1000, key: `${a.id}-${r.at}`, node: answer(a, r, i === 0 && !pending.some((p) => p.action.id === a.id)) })),
    ),
    ...pending.map((p) => ({ at: p.key / 1000, key: `pending-${p.key}`, node: answer(p.action, undefined, false) })),
  ].filter((x) => x.at >= since);
  const fresh = !answers.length && chat.ready && !chat.more && !chat.busy && !chat.messages.length && !chat.queued.length;

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
          actions={<><IconButton icon="search" label="Find in this chat" aria-pressed={finding} className={finding ? "bg-select text-ink" : ""} onClick={() => (finding ? closeFind() : setFinding(true))} /><IconButton icon="bolt" label={panel === "actions" ? "Hide actions" : "Actions"} aria-pressed={panel === "actions"} className={panel === "actions" ? "bg-select text-ink" : ""} onClick={() => togglePanel("actions")} /><span className="relative flex"><IconButton icon="globe" label={panel === "browser" ? "Hide the browser" : browserBusy ? "Browser (open)" : "Browser"} aria-pressed={panel === "browser"} className={panel === "browser" ? "bg-select text-ink" : ""} onClick={() => togglePanel("browser")} />{browserBusy && panel !== "browser" && <span aria-hidden="true" className="pointer-events-none absolute top-1.5 right-1.5 size-2 rounded-full bg-working ring-2 ring-page" />}</span></>}
        />
        {finding && <FindBar query={query} onQuery={setQuery} count={found.count} current={found.current} onNext={found.next} onPrevious={found.previous} onClose={closeFind} />}
        <div className="relative min-h-0 flex-1">
          <div ref={scroller.box} style={{ paddingBottom: room }} className="h-full overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-5">
              {chat.more && <p className="flex items-center justify-center gap-2 pb-4 text-xs text-ink-3">{chat.loadingEarlier ? <><Icon name="spinner" size={12} /> Loading earlier messages…</> : <button type="button" onClick={() => void chat.loadEarlier()} className="underline">Load earlier messages</button>}</p>}
              {!chat.ready ? <LoadingChat /> : fresh ? <EmptyChat name={agent.name} avatar={avatarOf(agent)} shortcuts={shortcuts} onPick={(text) => put({ text, images: [] })} /> : <MessageList messages={chat.messages} busy={chat.busy} asking={chat.asking} onAnswer={chat.answer} onReply={reply} onRetry={retry} onEdit={put} queued={chat.queued} onUnqueue={unqueue} extras={answers} note={chat.note === NO_REPLY ? problem("No reply came. Send your message again, or try another model.", ["retry", "model"], "info") : chat.note} />}
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
                above={panel !== "actions" && !actionsOff && !!acts.actions?.length && (
                  <div role="toolbar" aria-label="Actions" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
                    {acts.actions.map((a) => (
                      <button key={a.id} type="button" disabled={running.has(a.id)} onClick={() => start(a)} title={a.about || a.title} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-page px-3 text-[13px] text-ink ring-1 ring-line-strong transition-colors hover:bg-select disabled:opacity-60">
                        <Icon name={running.has(a.id) ? "spinner" : a.icon} size={13} className="text-ink-2" />
                        {a.title}
                      </button>
                    ))}
                  </div>
                )}
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
      {openedAction && <ActionDetail action={openedAction} agentId={agent.id} agentName={agent.name} onRun={() => start(openedAction)} onChanged={() => void acts.refresh()} onRemove={() => remove(openedAction)} onClose={() => setOpened(null)} />}
      {making && <NewAction agentId={agent.id} agentName={agent.name} onMade={(made) => (setMaking(false), void acts.refresh().then(() => setOpened(made.id)))} onClose={() => setMaking(false)} />}
      {asked && <RunDialog action={asked} onRun={(input) => void go(asked, input)} onClose={() => setAsked(null)} />}
      {panel && wide && (
        <aside aria-label={PANELS[panel]} className="w-80 shrink-0 overflow-y-auto border-l border-line">
          <Side panel={panel} agent={agent} actions={actionsPanel} onTaken={onActivity} />
        </aside>
      )}
      {panel && !wide && (
        <Modal title={PANELS[panel]} onClose={() => setSheet(null)} width="max-w-md">
          <div className="-mx-4 -mt-4 -mb-2">
            <Side panel={panel} agent={agent} actions={actionsPanel} onTaken={onActivity} />
          </div>
        </Modal>
      )}
    </div>
    </PreviewProvider>
  );
}

// What the agent does for you (with a tap, or by itself at set times) is one panel; its browser, a live screen, is the other.
const Side = ({ panel, agent, actions, onTaken }: { panel: Panel; agent: Agent; actions: ReactNode; onTaken: () => void }) =>
  panel === "actions" ? (
    actions
  ) : (
    <BrowserPanel agentId={agent.id} agentName={agent.name} off={agent.disabled.includes("browser")} taken={!!agent.taken} open={!!agent.browserOpen} onTaken={onTaken} />
  );
