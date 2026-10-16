import { useEffect, useState, type ReactNode } from "react";
import { createAgent, type Agent } from "../../api/agents";
import type { Model, Provider } from "../../api/providers";
import type { User } from "../../api/user";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { Card } from "../../components/ui/Row";
import { Select } from "../../components/ui/Select";
import { modelChoices, recommendedModel } from "../../lib/models";
import { useAction } from "../../lib/useAction";
import { ProviderRow } from "../settings/ProvidersPage";
import { AboutYouForm } from "../user/AboutYouForm";
import { STARTERS, type Starter } from "./starters";

interface Props {
  providers: Provider[];
  models?: Model[];
  user: User;
  onChange: () => void;
  onModels: (ids: string[]) => void;
  onCreated: (agent: Agent) => Promise<void>;
  onFromScratch: () => void;
  onSettings: () => void;
}

/** The first run: connect a model, then pick a ready-made agent and start chatting. */
export function Setup({ providers, models, user, onChange, onModels, onCreated, onFromScratch, onSettings }: Props) {
  const connected = providers.some((p) => p.connected);
  const choices = modelChoices(models, providers);
  const [model, setModel] = useState("");
  useEffect(() => {
    if (!choices.some((c) => c.value === model)) setModel(recommendedModel(models, providers));
  }, [models, providers]);
  const [about, setAbout] = useState(false);
  const [named, setNamed] = useState(!!user.name);
  const { busy, error, run } = useAction();
  const start = (s: Starter) =>
    run(s.name, async () => onCreated(await createAgent({ name: s.name, instructions: s.instructions, avatar: s.avatar, model, thinking: "", skills: [], plugins: [], extensions: [], disabled: [], isolated: false, trusted: false, dailyTokens: 0 })));

  return (
    <div className="flex flex-1 justify-center overflow-y-auto px-4 py-10 sm:py-14">
      <div className="flex w-full max-w-2xl animate-rise flex-col gap-8">
        <header className="text-center">
          <h1 className="text-[24px] font-semibold tracking-tight">Welcome to Weilo Agents</h1>
          <p className="mt-1.5 text-[14px] text-ink-3">{connected ? "Pick your first agent and start chatting." : "Two steps and you are chatting with your first agent."}</p>
        </header>

        <Step n={1} title="Connect a model" done={connected} detail={connected ? `Connected: ${providers.filter((p) => p.connected).map((p) => p.name).join(", ")}` : "Sign in with an account you already have, or add an API key. It stays on this computer."}>
          {!connected && (
            <Card>
              {providers.map((p) => (
                <ProviderRow key={p.id} provider={p} models={models} onChange={onChange} onModels={onModels} />
              ))}
            </Card>
          )}
        </Step>

        <Step n={2} title="Choose your first agent" muted={!connected} detail="You can change its name, instructions and model at any time.">
          {connected && (
            <div className="flex flex-col gap-3">
              <ul className="grid gap-2 sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <li key={s.name}>
                    <button type="button" disabled={!!busy || !model} onClick={() => void start(s)} className="flex h-full w-full items-center gap-3 rounded-xl border border-line px-3 py-3 text-left transition-colors hover:bg-select disabled:opacity-60">
                      <Avatar spec={s.avatar} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium">{s.name}</span>
                        <span className="block text-xs text-ink-3">{s.blurb}</span>
                      </span>
                      {busy === s.name && <Icon name="spinner" size={15} className="shrink-0 text-ink-3" />}
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" disabled={!!busy} onClick={onFromScratch} className="flex h-full w-full items-center gap-3 rounded-xl border border-dashed border-line-strong px-3 py-3 text-left transition-colors hover:bg-select">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-card">
                      <Icon name="plus" size={18} className="text-ink-2" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-medium">Start from scratch</span>
                      <span className="block text-xs text-ink-3">Name it and write its instructions yourself.</span>
                    </span>
                  </button>
                </li>
              </ul>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
                <span>Model</span>
                <div className="pick w-full min-w-0 sm:w-72">
                  <Select label="Model" value={model} onChange={setModel} options={choices} placeholder={models ? "Choose a model" : "Loading models…"} disabled={!models} />
                </div>
              </div>
              <ErrorText>{error}</ErrorText>
            </div>
          )}
        </Step>

        {!named && (
          <section className="rounded-xl border border-line px-4 py-3">
            {about ? (
              <AboutYouForm user={user} onSaved={() => (setNamed(true), onChange())} onSkip={() => setAbout(false)} />
            ) : (
              <button type="button" onClick={() => setAbout(true)} className="flex w-full items-center gap-3 text-left">
                <Icon name="user" size={16} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 text-[13.5px]">
                  Tell your agents your name <span className="text-ink-3">(optional)</span>
                </span>
                <Icon name="chevronRight" size={15} className="text-ink-3" />
              </button>
            )}
          </section>
        )}

        <p className="text-center text-xs text-ink-3">
          Looking for something else?{" "}
          <button type="button" onClick={onSettings} className="underline underline-offset-2">
            Open Settings
          </button>
        </p>
      </div>
    </div>
  );
}

function Step({ n, title, detail, done = false, muted = false, children }: { n: number; title: string; detail: string; done?: boolean; muted?: boolean; children?: ReactNode }) {
  return (
    <section className={`flex flex-col gap-3 ${muted ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-3">
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${done ? "bg-good text-page" : "bg-ink text-page"}`}>{done ? <Icon name="check" size={14} /> : n}</span>
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>
          <p className="text-[13px] text-ink-3">{detail}</p>
        </div>
      </div>
      {children && <div className="sm:pl-10">{children}</div>}
    </section>
  );
}
