import { useEffect, useState, type ReactNode } from "react";
import { closeFirstRun, finishSetup, loadEngines } from "../../lib/app";
import { cx, engineTitle } from "../../lib/format";
import { useApp } from "../../lib/store";
import { useDesktop } from "../../lib/useMedia";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { ChevronDownIcon } from "../../ui/glyphs";

type Step = "engine" | "awake" | "phone";

/** Connect your AI → keep it awake → get Ava on your phone. Two taps when an AI app is found. */
export function FirstRun() {
  const setup = useApp((s) => s.snapshot!.setup);
  const [step, setStep] = useState<Step>(setup.done ? "phone" : "engine");
  const [engine, setEngine] = useState<string | null>(null);
  const desktop = useDesktop();
  const n = step === "engine" ? 1 : step === "awake" ? 2 : 3;

  return (
    <div className="flex h-full justify-center overflow-y-auto bg-bg">
      <main className={cx("flex w-full max-w-[480px] flex-col gap-6", desktop ? "px-6 pt-24 pb-12" : "safe-top px-4 pt-16 pb-8")}>
        <span className="text-caption font-medium text-text-tertiary">Step {n} of 3</span>
        {step === "engine" && (
          <EngineStep
            found={setup.found_engines}
            onPick={(id) => {
              setEngine(id);
              setStep("awake");
            }}
          />
        )}
        {step === "awake" && engine && <AwakeStep engine={engine} onDone={() => setStep("phone")} />}
        {step === "phone" && <PhoneStep />}
      </main>
    </div>
  );
}

function Heading({ title, line }: { title: string; line?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="m-0 text-display font-semibold tracking-[-0.01em]">{title}</h1>
      {line && <p className="m-0 text-body text-text-secondary">{line}</p>}
    </div>
  );
}

function EngineStep({ found, onPick }: { found: string[]; onPick(id: string): void }) {
  const engines = useApp((s) => s.engines);
  const [others, setOthers] = useState(false);
  const desktop = useDesktop();
  useEffect(() => {
    if (!engines) loadEngines().catch(() => {});
  }, [engines]);
  const best = found[0] ?? null;
  const rest = (engines ?? []).filter((e) => e.id !== (best ?? "pi"));
  const size = desktop ? "lg" : "phone";

  return (
    <>
      <Heading title="Connect your AI" line="Weilo works with the AI app you already use." />
      <Card phone={!desktop} className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1">
          <div className="text-title-sm font-semibold">
            {best ? `We found ${engineTitle(best, engines ?? undefined)}. Use it?` : "Use Weilo's built-in AI"}
          </div>
          <div className="text-body-sm text-text-secondary">
            {best ? "Your agent works through it, with your own sign-in." : "It works with your own API key."}
          </div>
        </div>
        <Button variant="primary" size={size} onClick={() => onPick(best ?? "pi")} autoFocus>
          Use it
        </Button>
      </Card>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={others}
          aria-controls="other-ai"
          onClick={() => setOthers((v) => !v)}
          className="flex h-11 w-fit items-center gap-1.5 rounded-md border-0 bg-transparent px-1 text-body-sm font-medium text-text-secondary"
        >
          <ChevronDownIcon size={12} className={cx("transition-transform", !others && "-rotate-90")} />
          Other AI apps
        </button>
        {others && (
          <ul id="other-ai" className="m-0 flex list-none flex-col rounded-lg border border-border bg-surface p-0">
            {!engines && <li className="p-4 text-body-sm text-text-secondary">Looking for AI apps…</li>}
            {rest.map((e, i) => (
              <li key={e.id} className={cx("flex min-h-14 items-center gap-3 px-4 py-2", i < rest.length - 1 && "shadow-line")}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{engineTitle(e.id, [e])}</span>
                  <span className="text-caption text-text-secondary">{e.description}</span>
                </span>
                <Button size={desktop ? "md" : "phone"} disabled={!e.installed} onClick={() => onPick(e.id)}>
                  Use
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function AwakeStep({ engine, onDone }: { engine: string; onDone(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desktop = useDesktop();
  const finish = async (keepAwake: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await finishSetup(engine, keepAwake);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const size = desktop ? "lg" : "phone";
  return (
    <>
      <Heading title="Keep your agent working while this computer is plugged in?" line="It stays awake while charging." />
      <div className={cx("flex gap-2", !desktop && "flex-col")}>
        <Button variant="primary" size={size} disabled={busy} onClick={() => void finish(true)} autoFocus>
          Yes
        </Button>
        <Button size={size} disabled={busy} onClick={() => void finish(false)}>
          Not now
        </Button>
      </div>
      {error && (
        <p role="alert" className="m-0 text-body-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}

function PhoneStep() {
  const main = useApp((s) => s.snapshot?.agents[0]?.name ?? "Ava");
  const desktop = useDesktop();
  return (
    <>
      <Heading
        title={`Get ${main} on your phone`}
        line="On your Weilo computer, open a terminal and run this. It shows a link to open on your phone."
      />
      <code className="flex h-11 items-center rounded-md border border-border bg-surface px-3 font-mono text-body text-text">weilo pair</code>
      <Button size={desktop ? "lg" : "phone"} className="w-fit max-md:w-full" onClick={closeFirstRun}>
        Skip
      </Button>
    </>
  );
}
