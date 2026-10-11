import { useEffect, useRef, useState } from "react";
import type { Agent } from "../../api/agents";
import type { Extension } from "../../api/extensions";
import type { Plugin } from "../../api/plugins";
import type { Model, Provider } from "../../api/providers";
import type { Skill } from "../../api/skills";
import type { User } from "../../api/user";
import { KEYS, read, write } from "../../lib/storage";
import { useMedia } from "../../lib/useMedia";
import { AgentForm } from "../agents/AgentForm";
import { ChatView } from "../chat/ChatView";
import { SettingsModal, type SettingsPage } from "../settings/SettingsModal";
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
  const [selected, setSelected] = useState(() => read(KEYS.agent));
  const [showChat, setShowChat] = useState(false);
  const [form, setForm] = useState<"new" | "edit" | null>(null);
  // The settings popup, open at a page.
  const [settings, setSettings] = useState<SettingsPage | "menu" | null>(null);
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
    setShowChat(true);
  };

  return (
    <div className="flex h-full">
      <div className={`${showChat ? "hidden" : "flex"} w-full md:flex md:w-auto`}>
        <Sidebar agents={agents} unread={unread} selected={agent?.id} onSelect={select} onNew={() => setForm("new")} onSkills={() => setSettings("skills")} onPlugins={() => setSettings("plugins")} onSettings={() => setSettings("menu")} />
      </div>
      <main className={`${showChat ? "flex" : "hidden"} min-w-0 flex-1 md:flex`}>
        {agent ? (
          <ChatView
            key={agent.id}
            agent={agent}
            models={models}
            hasProvider={providers.some((p) => p.connected)}
            onBack={() => setShowChat(false)}
            onEdit={() => setForm("edit")}
            onActivity={reloadAgents}
            onOpenSettings={() => setSettings("providers")}
          />
        ) : (
          <GetStarted onCreateAgent={() => setForm("new")} />
        )}
      </main>
      {form && (
        <AgentForm
          agent={form === "edit" ? agent : undefined}
          providers={providers}
          skills={skills}
          plugins={plugins}
          extensions={extensions}
          models={models}
          onAddProvider={() => setSettings("providers")}
          onOpenSettings={setSettings}
          onClose={() => setForm(null)}
          onSaved={async (saved) => (await reloadAgents(), select(saved.id), setForm(null))}
          onDeleted={() => (setForm(null), setShowChat(false), reloadAgents())}
        />
      )}
      {welcome && <Welcome user={user} onDone={() => (write(KEYS.welcomed, "1"), setWelcome(false), reload())} />}
      {settings && <SettingsModal page={settings} providers={providers} skills={skills} plugins={plugins} extensions={extensions} user={user} models={models} onModels={onModels} onChange={reload} onClose={() => setSettings(null)} />}
    </div>
  );
}
