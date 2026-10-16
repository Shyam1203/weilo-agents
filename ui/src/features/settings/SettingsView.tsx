import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Agent } from "../../api/agents";
import type { Extension } from "../../api/extensions";
import type { Plugin } from "../../api/plugins";
import type { Model, Provider } from "../../api/providers";
import type { Skill } from "../../api/skills";
import type { User } from "../../api/user";
import { IconButton } from "../../components/ui/Button";
import { Icon, type IconName } from "../../components/ui/Icon";
import { Page } from "../../components/ui/Row";
import { getTheme } from "../../lib/theme";
import { useMedia } from "../../lib/useMedia";
import { ExtensionsPage } from "../extensions/ExtensionsPage";
import { MemoryPage } from "../memory/MemoryPage";
import { PluginsPage } from "../plugins/PluginsPage";
import { DevicesPage } from "./DevicesPage";
import { SkillsPage } from "../skills/SkillsPage";
import { AboutYouForm } from "../user/AboutYouForm";
import { AboutPage } from "./AboutPage";
import { NotificationsPage } from "./NotificationsPage";
import { Appearance } from "./Appearance";
import { ProvidersPage } from "./ProvidersPage";
import { ActivityPage } from "./ActivityPage";
import { UsagePage } from "./UsagePage";

export type SettingsPage = "you" | "memory" | "providers" | "usage" | "skills" | "plugins" | "extensions" | "devices" | "general";

const MENU: { group: string; pages: { value: SettingsPage; label: string; icon: IconName }[] }[] = [
  {
    group: "You",
    pages: [
      { value: "you", label: "About you", icon: "user" },
      { value: "memory", label: "Memory", icon: "brain" },
    ],
  },
  {
    group: "Models",
    pages: [
      { value: "providers", label: "Providers", icon: "key" },
      { value: "usage", label: "Usage", icon: "chart" },
    ],
  },
  {
    group: "What agents can use",
    pages: [
      { value: "skills", label: "Skills", icon: "sparkle" },
      { value: "plugins", label: "Plugins", icon: "puzzle" },
      { value: "extensions", label: "Extensions", icon: "plug" },
    ],
  },
  {
    group: "App",
    pages: [
      { value: "devices", label: "Devices", icon: "devices" },
      { value: "general", label: "General", icon: "settings" },
    ],
  },
];

const LABELS = Object.fromEntries(MENU.flatMap((m) => m.pages).map((p) => [p.value, p.label]));

interface Props {
  page: SettingsPage | "menu";
  agents: Agent[];
  providers: Provider[];
  skills: Skill[];
  plugins: Plugin[];
  extensions: Extension[];
  user: User;
  models?: Model[];
  onChange: () => void;
  onModels: (ids: string[]) => void;
  onClose: () => void;
}

export function SettingsView({ page: first, agents, providers, skills, plugins, extensions, user, models, onChange, onModels, onClose }: Props) {
  const wide = useMedia("(min-width: 768px)");
  const [chosen, setChosen] = useState<SettingsPage | null>(first === "menu" ? null : first);
  useEffect(() => setChosen(first === "menu" ? null : first), [first]);
  const page = chosen ?? "you";
  const list = !wide && chosen === null;
  const back = wide || list ? onClose : () => setChosen(null);

  const count = (n: number, one: string, many = `${one}s`) => (n ? `${n} ${n === 1 ? one : many}` : "None");
  const theme = getTheme();
  const hints: Partial<Record<SettingsPage, string>> = {
    providers: count(providers.filter((p) => p.connected).length, "connected", "connected"),
    you: user.name || undefined,
    general: theme === "weilo" ? "Weilo" : theme === "system" ? "System" : theme === "dark" ? "Dark" : "Light",
    skills: count(skills.length, "skill"),
    plugins: count(plugins.length, "plugin"),
    extensions: count(extensions.length, "extension"),
  };

  const goBack = useRef(back);
  goBack.current = back;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && !document.querySelector('[role="dialog"]') && goBack.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-w-0 flex-1 flex-col pb-[var(--safe-bottom)]">
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-3 sm:px-4">
        <IconButton icon="chevronLeft" label={wide || list ? "Back to the chat" : "Back"} onClick={back} className="-ml-1" />
        <h2 className="text-[15px] font-semibold tracking-tight">{wide || list ? "Settings" : LABELS[page]}</h2>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {(wide || list) && (
          <nav aria-label="Settings" className={`flex shrink-0 flex-col gap-4 overflow-y-auto p-2 md:w-56 md:border-r md:border-line md:bg-panel ${list ? "flex-1" : ""}`}>
            {MENU.map(({ group, pages }) => (
              <div key={group} className="flex flex-col gap-1">
                {group && <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">{group}</p>}
                {pages.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    aria-current={wide && page === p.value ? "page" : undefined}
                    onClick={() => setChosen(p.value)}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-[13.5px] transition-colors md:py-2 ${wide && page === p.value ? "bg-select font-medium text-ink" : "text-ink-2 hover:bg-select hover:text-ink"}`}
                  >
                    <Icon name={p.icon} size={15} className="shrink-0" />
                    <span className="flex-1">{p.label}</span>
                    {!wide && hints[p.value] && <span className="max-w-[45%] truncate text-[12.5px] text-ink-3">{hints[p.value]}</span>}
                    {!wide && <Icon name="chevronRight" size={15} className="shrink-0 text-ink-3" />}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        )}
        {!list && (
          <div className="min-w-0 flex-1 overflow-y-auto p-5 sm:p-8">
            <div className="mx-auto w-full max-w-2xl">
              {page === "providers" ? (
                <ProvidersPage providers={providers} models={models} onChange={onChange} onModels={onModels} />
              ) : page === "usage" ? (
                <UsagePage agents={agents} />
              ) : page === "devices" ? (
                <Sections>
                  <DevicesPage section />
                  <ActivityPage agents={agents} section />
                </Sections>
              ) : page === "general" ? (
                <Sections>
                  <Appearance />
                  <NotificationsPage agents={agents} section />
                  <AboutPage />
                </Sections>
              ) : page === "you" ? (
                <Page title="About you" description="Agents use this to talk to you.">
                  <AboutYouForm user={user} onSaved={onChange} />
                </Page>
              ) : page === "memory" ? (
                <MemoryPage providers={providers} models={models} />
                            ) : page === "skills" ? (
                <SkillsPage skills={skills} agents={agents} onChange={onChange} />
              ) : page === "plugins" ? (
                <PluginsPage plugins={plugins} onChange={onChange} />
              ) : (
                <ExtensionsPage extensions={extensions} onChange={onChange} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const Sections = ({ children }: { children: ReactNode }) => <div className="flex flex-col gap-10">{children}</div>;
