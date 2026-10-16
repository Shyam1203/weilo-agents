import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { getUpdate, type Update } from "../../api/app";
import { AGENT_STATUS_URL, reorderAgents, type Agent, type AgentStatus } from "../../api/agents";
import type { Extension } from "../../api/extensions";
import type { Plugin } from "../../api/plugins";
import type { Model, Provider } from "../../api/providers";
import type { Skill } from "../../api/skills";
import type { User } from "../../api/user";
import { KEYS, read, write } from "../../lib/storage";
import { useBackStep } from "../../lib/useBackStep";
import { useEdgeSwipe } from "../../lib/useEdgeSwipe";
import { useMedia } from "../../lib/useMedia";
import { ChatView } from "../chat/ChatView";
import type { SettingsPage } from "../settings/SettingsView";
import { ContactDialog } from "../support/ContactDialog";
import { Welcome } from "../user/Welcome";
import { GetStarted } from "./GetStarted";
import { Sidebar } from "./Sidebar";
import { useUnread } from "./useUnread";

const AgentForm = lazy(() => import("../agents/AgentForm").then((m) => ({ default: m.AgentForm })));
const SettingsView = lazy(() => import("../settings/SettingsView").then((m) => ({ default: m.SettingsView })));

interface Props {
  agents: Agent[];
  providers: Provider[];
  skills: Skill[];
  plugins: Plugin[];
  extensions: Extension[];
  user: User;
  models?: Model[];
  onModels: (ids: string[]) => void;
  reload: () => Promise<void>;
  reloadAgents: () => Promise<void>;
  patchAgent: (status: AgentStatus) => void;
}

export function Workspace({ agents, providers, skills, plugins, extensions, user, models, onModels, reload, reloadAgents, patchAgent }: Props) {
  const [opened] = useState(() => new URLSearchParams(location.search).get("agent"));
  const [selected, setSelected] = useState(() => opened ?? read(KEYS.agent));
  const [showChat, setShowChat] = useState(!!opened);
  useEffect(() => {
    if (opened) history.replaceState(history.state, "", location.pathname);
  }, [opened]);
  const [form, setForm] = useState<"new" | "edit" | null>(null);
  const [settings, setSettings] = useState<SettingsPage | "menu" | null>(null);
  const openSettings = (page: SettingsPage | "menu") => (void reload(), setSettings(page));
  const [contact, setContact] = useState(false);
  const [find, setFind] = useState<{ query: string; at: number } | null>(null);
  const [live, setLive] = useState<{ busy: boolean; doing: string | null } | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const settingsOpen = settings !== null;
  useEffect(() => void getUpdate().then(setUpdate, () => {}), [settingsOpen]);
  const [welcome, setWelcome] = useState(!user.name && !read(KEYS.welcomed));
  const agent = agents.find((a) => a.id === selected) ?? agents[0];
  const wide = useMedia("(min-width: 768px)");
  const unread = useUnread(agents, showChat || wide ? agent?.id : undefined);

  const refresh = useRef(reloadAgents);
  refresh.current = reloadAgents;
  const patch = useRef(patchAgent);
  patch.current = patchAgent;
  // While the app is on screen it listens for changes to the agent list and reads it again then.
  useEffect(() => {
    let source: EventSource | null = null;
    const look = () => {
      if (document.visibilityState !== "visible") return void (source?.close(), (source = null));
      if (source) return;
      source = new EventSource(AGENT_STATUS_URL);
      source.onopen = () => void refresh.current();
      source.onmessage = (m) => {
        const status: AgentStatus = JSON.parse(m.data);
        if (status.id) patch.current(status);
        else void refresh.current();
      };
    };
    look();
    document.addEventListener("visibilitychange", look);
    return () => (source?.close(), document.removeEventListener("visibilitychange", look));
  }, []);

  const select = (id: string) => {
    setSelected(id);
    write(KEYS.agent, id);
    setSettings(null);
    setForm(null);
    setShowChat(true);
  };

  const choose = useRef(select);
  choose.current = select;
  useEffect(() => {
    const onMessage = (e: MessageEvent) => e.data?.type === "open-agent" && e.data.agent && choose.current(e.data.agent);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);

  const covered = !wide && (showChat || settings !== null);
  const uncover = () => (setShowChat(false), setSettings(null));
  useBackStep(covered, uncover);
  const swipe = useEdgeSwipe(uncover, covered);

  return (
    <div className="flex h-full">
      <div className={`${showChat || settings ? "hidden" : "flex"} w-full md:flex md:w-auto`}>
        <Sidebar
          agents={agents.map((a) => (live && a.id === agent?.id ? { ...a, working: live.busy, doing: live.busy ? (live.doing ?? "") : null } : a))}
          unread={unread}
          selected={settings ? undefined : agent?.id}
          update={update}
          onSelect={(id) => (setFind(null), select(id))}
          onFound={(id, query, at) => (setFind({ query, at }), select(id))}
          onReorder={(ids) => reorderAgents(ids).then(reloadAgents, () => {})}
          onNew={() => (setSettings(null), setForm("new"))}
          onSettings={() => openSettings("menu")}
          onAbout={() => openSettings("general")}
          onContact={() => setContact(true)}
        />
      </div>
      <main ref={swipe} className={`${showChat || settings ? "flex" : "hidden"} min-w-0 flex-1 md:flex`}>
        {settings && (
          <Suspense>
            <SettingsView page={settings} agents={agents} providers={providers} skills={skills} plugins={plugins} extensions={extensions} user={user} models={models} onModels={onModels} onChange={reload} onClose={() => setSettings(null)} />
          </Suspense>
        )}
        <div className={settings ? "hidden" : "contents"}>
          {agent ? (
            <ChatView
              key={agent.id}
              agent={agent}
              models={models}
              hasProvider={providers.some((p) => p.connected)}
              onBack={() => setShowChat(false)}
              onEdit={() => setForm("edit")}
              onActivity={reloadAgents}
              onLive={setLive}
              find={find}
              onOpenSettings={() => openSettings("providers")}
            />
          ) : (
            <GetStarted onCreateAgent={() => setForm("new")} />
          )}
        </div>
      </main>
      {form && (
        <Suspense>
          <AgentForm
            agent={form === "edit" ? agent : undefined}
            providers={providers}
            skills={skills}
            plugins={plugins}
            extensions={extensions}
            models={models}
            hidden={settings !== null}
            onAddProvider={() => openSettings("providers")}
            onOpenSettings={openSettings}
            onClose={() => setForm(null)}
            onSaved={async (saved) => (await reloadAgents(), select(saved.id), setForm(null))}
            onDeleted={() => (setForm(null), setShowChat(false), reloadAgents())}
          />
        </Suspense>
      )}
      {welcome && <Welcome user={user} onDone={() => (write(KEYS.welcomed, "1"), setWelcome(false), reload())} />}
      {contact && <ContactDialog name={user.name} onClose={() => setContact(false)} />}
    </div>
  );
}
