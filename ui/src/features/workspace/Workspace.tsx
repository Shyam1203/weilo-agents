import { useEffect, useRef, useState } from "react";
import { getUpdate, type Update } from "../../api/app";
import { reorderAgents, type Agent } from "../../api/agents";
import type { Extension } from "../../api/extensions";
import type { Plugin } from "../../api/plugins";
import type { Model, Provider } from "../../api/providers";
import type { Skill } from "../../api/skills";
import type { User } from "../../api/user";
import { KEYS, read, write } from "../../lib/storage";
import { useBackStep } from "../../lib/useBackStep";
import { useEdgeSwipe } from "../../lib/useEdgeSwipe";
import { useMedia } from "../../lib/useMedia";
import { AgentForm } from "../agents/AgentForm";
import { ChatView } from "../chat/ChatView";
import { SettingsView, type SettingsPage } from "../settings/SettingsView";
import { ContactDialog } from "../support/ContactDialog";
import { Welcome } from "../user/Welcome";
import { GetStarted } from "./GetStarted";
import { Sidebar } from "./Sidebar";
import { useUnread } from "./useUnread";

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
}

/** The agent list beside the open chat; on a phone, one at a time. */
export function Workspace({ agents, providers, skills, plugins, extensions, user, models, onModels, reload, reloadAgents }: Props) {
  // A tapped notification opens the app at its agent (`?agent=`).
  const [opened] = useState(() => new URLSearchParams(location.search).get("agent"));
  const [selected, setSelected] = useState(() => opened ?? read(KEYS.agent));
  const [showChat, setShowChat] = useState(!!opened);
  useEffect(() => {
    if (opened) history.replaceState(history.state, "", location.pathname);
  }, [opened]);
  const [form, setForm] = useState<"new" | "edit" | null>(null);
  // Settings, in place of the chat, open at a page. Opening it reads the lists again (an agent may have added a skill).
  const [settings, setSettings] = useState<SettingsPage | "menu" | null>(null);
  const openSettings = (page: SettingsPage | "menu") => (void reload(), setSettings(page));
  const [contact, setContact] = useState(false);
  // Words to find in the chat as it opens (a search of all chats), and near which message (its time, s).
  const [find, setFind] = useState<{ query: string; at: number } | null>(null);
  // The open chat's own word on whether its agent works and what it does: the list polls, so it follows the chat for that agent.
  const [live, setLive] = useState<{ busy: boolean; doing: string | null } | null>(null);
  // A newer release, if there is one (the daemon asks now and then).
  const [update, setUpdate] = useState<Update | null>(null);
  // Asked again when Settings closes: the check may have been switched on or off there.
  const settingsOpen = settings !== null;
  useEffect(() => void getUpdate().then(setUpdate, () => {}), [settingsOpen]);
  // The first time, and until you give a name or skip: ask what agents should call you.
  const [welcome, setWelcome] = useState(!user.name && !read(KEYS.welcomed));
  const agent = agents.find((a) => a.id === selected) ?? agents[0];
  // The chat is on screen beside the list, or alone once opened on a phone.
  const wide = useMedia("(min-width: 768px)");
  const unread = useUnread(agents, showChat || wide ? agent?.id : undefined);

  // An agent keeps working when its chat is not open: look again at the list now and then (sooner while one works), and when the tab comes back.
  const refresh = useRef(reloadAgents);
  refresh.current = reloadAgents;
  const working = agents.some((a) => a.working);
  useEffect(() => {
    const look = () => document.visibilityState === "visible" && void refresh.current();
    const timer = setInterval(look, working ? 2000 : 5000);
    document.addEventListener("visibilitychange", look);
    return () => (clearInterval(timer), document.removeEventListener("visibilitychange", look));
  }, [working]);

  const select = (id: string) => {
    setSelected(id);
    write(KEYS.agent, id);
    setSettings(null);
    setForm(null);
    setShowChat(true);
  };

  // A notification tapped while the app is open already: the service worker says which agent.
  const choose = useRef(select);
  choose.current = select;
  useEffect(() => {
    const onMessage = (e: MessageEvent) => e.data?.type === "open-agent" && e.data.agent && choose.current(e.data.agent);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);

  // On a phone the chat and Settings cover the list: back (the phone's button or gesture, or a swipe from the left edge) shows it again.
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
          onSkills={() => openSettings("skills")}
          onPlugins={() => openSettings("plugins")}
          onSettings={() => openSettings("menu")}
          onAbout={() => openSettings("about")}
          onContact={() => setContact(true)}
        />
      </div>
      <main ref={swipe} className={`${showChat || settings ? "flex" : "hidden"} min-w-0 flex-1 md:flex`}>
        {settings && <SettingsView page={settings} agents={agents} providers={providers} skills={skills} plugins={plugins} extensions={extensions} user={user} models={models} onModels={onModels} onChange={reload} onClose={() => setSettings(null)} />}
        {/* The chat stays mounted behind Settings, so what you were typing is still there. */}
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
      )}
      {welcome && <Welcome user={user} onDone={() => (write(KEYS.welcomed, "1"), setWelcome(false), reload())} />}
      {contact && <ContactDialog name={user.name} onClose={() => setContact(false)} />}
    </div>
  );
}
