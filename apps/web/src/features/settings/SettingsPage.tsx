import { useState, type ReactNode } from "react";
import { savePrefs } from "../../lib/app";
import { SECTION_KEYS, SECTION_TITLES, withSection } from "../../lib/sidebar";
import { useApp } from "../../lib/store";
import { setTheme, useTheme, type Theme } from "../../lib/theme";
import { Button } from "../../ui/Button";
import { Switch } from "../../ui/Switch";
import { Tabs } from "../../ui/Tabs";
import { canPick, needKind, statusLine } from "../../lib/engines";
import { engineTitle } from "../../lib/format";
import type { EngineInfo } from "../../proto/EngineInfo";
import { TextWithCode } from "../../ui/bits";
import { EngineHelpDialog } from "../engines/EngineHelpDialog";
import { useEngineList } from "../engines/EnginePicker";
import { KeyDialog } from "../engines/KeyDialog";
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

      <Group title="AI">
        <EngineRows phone={phone} />
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

/**
 * The AI apps Weilo can use, each with its one status line. Keys are added, replaced or
 * removed in the key dialog, which only ever says "Saved", never the key.
 */
function EngineRows({ phone }: { phone?: boolean }) {
  const engines = useEngineList();
  if (!engines) return <p className="m-0 text-body-sm text-text-secondary">Looking for AI apps…</p>;
  return (
    <div className="flex flex-col">
      {engines.map((e) => (
        <EngineRow key={e.id} engine={e} phone={phone} />
      ))}
    </div>
  );
}

function EngineRow({ engine: e, phone }: { engine: EngineInfo; phone?: boolean }) {
  const [open, setOpen] = useState(false);
  const keys = e.key_providers ?? [];
  const saved = keys.filter((k) => k.has_key).length;
  const need = e.ready ? null : needKind(e.needs);
  const help = need === "sign_in" || need === "install" ? need : null;
  const size = phone ? "phone" : "md";
  return (
    <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 py-2 shadow-line">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={canPick(e) ? "font-medium" : "font-medium text-text-secondary"}>{engineTitle(e.id, [e])}</span>
        <span className="text-caption text-text-secondary">
          <TextWithCode text={statusLine(e)} />
          {keys.length > 0 && saved > 0 ? ` Key saved for ${keys.filter((k) => k.has_key).map((k) => k.title).join(" and ")}.` : ""}
        </span>
      </span>
      {keys.length > 0 ? (
        <Button size={size} onClick={() => setOpen(true)}>
          {saved > 0 ? "Keys" : "Add a key"}
        </Button>
      ) : help ? (
        <Button size={size} onClick={() => setOpen(true)}>
          {help === "sign_in" ? "Sign in" : "Install"}
        </Button>
      ) : null}
      {keys.length > 0 && <KeyDialog open={open} onClose={() => setOpen(false)} engineId={e.id} />}
      {keys.length === 0 && help && <EngineHelpDialog open={open} onClose={() => setOpen(false)} engineId={e.id} kind={help} />}
    </div>
  );
}
