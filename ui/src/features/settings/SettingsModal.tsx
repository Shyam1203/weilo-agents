// The one popup for Settings and the add-ons. On a wide screen: pages in a menu on the left, rows
// on the right. On a phone: the list of pages first, then a page with a back arrow.
import { useState } from "react";
import type { Extension } from "../../api/extensions";
import type { Plugin } from "../../api/plugins";
import type { Model, Provider } from "../../api/providers";
import type { Skill } from "../../api/skills";
import type { User } from "../../api/user";
import { Icon, type IconName } from "../../components/ui/Icon";
import { Modal } from "../../components/ui/Modal";
import { Page } from "../../components/ui/Row";
import { useMedia } from "../../lib/useMedia";
import { BrowserSettings } from "../browser/BrowserSettings";
import { ExtensionsPage } from "../extensions/ExtensionsPage";
import { MemoryPage } from "../memory/MemoryPage";
import { PluginsPage } from "../plugins/PluginsPage";
import { SkillsPage } from "../skills/SkillsPage";
import { AboutYouForm } from "../user/AboutYouForm";
import { AboutPage } from "./AboutPage";
import { Appearance } from "./Appearance";
import { ProvidersPage } from "./ProvidersPage";

export type SettingsPage = "providers" | "you" | "memory" | "browser" | "appearance" | "about" | "skills" | "plugins" | "extensions";

const MENU: { group: string; pages: { value: SettingsPage; label: string; icon: IconName }[] }[] = [
  {
    group: "Settings",
    pages: [
      { value: "providers", label: "Providers", icon: "key" },
      { value: "you", label: "About you", icon: "user" },
      { value: "memory", label: "Memory", icon: "brain" },
      { value: "browser", label: "Browser", icon: "globe" },
      { value: "appearance", label: "Appearance", icon: "sun" },
      { value: "about", label: "About", icon: "info" },
    ],
  },
  {
    group: "Add-ons",
    pages: [
      { value: "skills", label: "Skills", icon: "sparkle" },
      { value: "plugins", label: "Plugins", icon: "puzzle" },
      { value: "extensions", label: "Extensions", icon: "plug" },
    ],
  },
];

const LABELS = Object.fromEntries(MENU.flatMap((m) => m.pages).map((p) => [p.value, p.label]));

interface Props {
  /** The page to open first; "menu" opens the list of pages on a phone (and Providers on a wide screen). */
  page: SettingsPage | "menu";
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

export function SettingsModal({ page: first, providers, skills, plugins, extensions, user, models, onChange, onModels, onClose }: Props) {
  const wide = useMedia("(min-width: 768px)");
  // On a phone `null` is the list of pages.
  const [chosen, setChosen] = useState<SettingsPage | null>(first === "menu" ? null : first);
  const page = chosen ?? "providers";
  const list = !wide && chosen === null;

  return (
    <Modal title={wide || list ? "Settings" : LABELS[page]} onBack={wide || list ? undefined : () => setChosen(null)} onClose={onClose} width="max-w-3xl" flush>
      <div className="flex h-[80dvh] min-h-0 w-full flex-col border-t border-line sm:h-[34rem] sm:max-h-[72dvh] md:flex-row">
        {(wide || list) && (
          <nav aria-label="Settings" className={`flex shrink-0 flex-col gap-1 overflow-y-auto p-2 md:w-48 md:border-r md:border-line md:bg-panel ${list ? "flex-1" : ""}`}>
            {MENU.map(({ group, pages }) => (
              <div key={group} className="flex flex-col gap-1">
                <p className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">{group}</p>
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
                    {!wide && <Icon name="chevronRight" size={15} className="shrink-0 text-ink-3" />}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        )}
        {!list && (
          <div className="min-w-0 flex-1 overflow-y-auto p-5 sm:p-6">
            {page === "providers" ? (
              <ProvidersPage providers={providers} models={models} onChange={onChange} onModels={onModels} />
            ) : page === "you" ? (
              <Page title="About you" description="Agents use this to talk to you.">
                <AboutYouForm user={user} onSaved={onChange} />
              </Page>
            ) : page === "memory" ? (
              <MemoryPage providers={providers} models={models} />
            ) : page === "browser" ? (
              <BrowserSettings />
            ) : page === "appearance" ? (
              <Appearance />
            ) : page === "about" ? (
              <AboutPage />
            ) : page === "skills" ? (
              <SkillsPage skills={skills} onChange={onChange} />
            ) : page === "plugins" ? (
              <PluginsPage plugins={plugins} onChange={onChange} />
            ) : (
              <ExtensionsPage extensions={extensions} onChange={onChange} />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
