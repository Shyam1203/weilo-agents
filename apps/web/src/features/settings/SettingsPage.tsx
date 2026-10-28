import { useState, type ReactNode } from "react";
import { savePrefs } from "../../lib/app";
import { SECTION_KEYS, SECTION_TITLES, withSection } from "../../lib/sidebar";
import { useApp } from "../../lib/store";
import { setTheme, useTheme, type Theme } from "../../lib/theme";
import { Button } from "../../ui/Button";
import { Switch } from "../../ui/Switch";
import { Tabs } from "../../ui/Tabs";
import { NewSessionDialog } from "../shell/dialogs";
import { PageFrame } from "../shell/PageFrame";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="m-0 flex h-7 items-center text-caption font-medium text-text-tertiary">{title}</h2>
      {children}
    </section>
  );
}

/** Kept small: how it looks, what the sidebar shows, and how to add a phone. */
export function SettingsPage({ phone }: { phone?: boolean }) {
  const prefs = useApp((s) => s.snapshot!.prefs);
  const hostName = useApp((s) => s.hostName);
  const keepAwake = useApp((s) => s.snapshot!.setup.keep_awake);
  const theme = useTheme();
  const [session, setSession] = useState(false);

  return (
    <PageFrame title={phone ? "You" : "Settings"} phone={phone}>
      <Group title="Look">
        <Tabs
          label="Theme"
          size={phone ? "phone" : "md"}
          value={theme}
          onChange={(v) => setTheme(v as Theme)}
          items={[
            { id: "system", label: "Same as this device" },
            { id: "light", label: "Light" },
            { id: "dark", label: "Dark" },
          ]}
        />
      </Group>

      <Group title="Sidebar">
        <div className="flex flex-col">
          {SECTION_KEYS.map((k) => (
            <div key={k} className="flex h-11 items-center gap-2 shadow-line">
              <span className="flex-1">{SECTION_TITLES[k]}</span>
              <Switch checked={prefs[k].shown} label={`Show ${SECTION_TITLES[k]}`} onChange={(shown) => void savePrefs(withSection(prefs, k, { shown }))} />
            </div>
          ))}
        </div>
        <p className="m-0 text-caption text-text-secondary">Hidden sections still send alerts to Needs you.</p>
      </Group>

      <Group title="Devices">
        <p className="m-0 text-body-sm text-text-secondary">
          To add a phone, run <code className="rounded-sm bg-surface-muted px-1 text-text">weilo pair</code> on your Weilo computer and open the link it shows.
        </p>
      </Group>

      <Group title="Your Weilo computer">
        <p className="m-0 text-body-sm text-text-secondary">
          {hostName ?? "This computer"} · {keepAwake ? "Stays awake while charging." : "Your agents pause when it sleeps."}
        </p>
      </Group>

      <Group title="Sessions">
        <div className="flex flex-wrap items-center gap-3 text-body-sm text-text-secondary">
          <span className="min-w-0 flex-1">Start a piece of work in a folder on this computer.</span>
          <Button size={phone ? "phone" : "md"} onClick={() => setSession(true)}>
            Start a session
          </Button>
        </div>
        <NewSessionDialog open={session} onClose={() => setSession(false)} />
      </Group>
    </PageFrame>
  );
}
