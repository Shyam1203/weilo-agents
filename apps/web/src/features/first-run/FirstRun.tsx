import { useState, type ReactNode } from "react";
import { checkEngine, closeFirstRun, finishSetup, loadEngines } from "../../lib/app";
import { alreadySays, canPick, engineHow, engineLine, needKind, problemKind, statusLine } from "../../lib/engines";
import { cx, engineTitle } from "../../lib/format";
import { useApp } from "../../lib/store";
import { useDesktop } from "../../lib/useMedia";
import type { EngineCheck } from "../../proto/EngineCheck";
import type { EngineInfo } from "../../proto/EngineInfo";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Disclosure, ErrorLine, TextWithCode } from "../../ui/bits";
import { ChevronDownIcon, SpinnerIcon } from "../../ui/glyphs";
import { helpText } from "../engines/EngineHelpDialog";
import { useEngineList } from "../engines/EnginePicker";
import { KeyFields, useKeyForm } from "../engines/KeyDialog";

type Step = "engine" | "awake";

/**
 * Connect your AI → keep it awake. Two taps when an AI app is found. (Getting Ava on a phone
 * comes with phone access in the next version.)
 */
export function FirstRun() {
  const setup = useApp((s) => s.snapshot!.setup);
  const [step, setStep] = useState<Step>("engine");
  const [engine, setEngine] = useState<string | null>(null);
  const desktop = useDesktop();
  const n = step === "engine" ? 1 : 2;

  return (
    <div className="flex h-full justify-center overflow-y-auto bg-bg">
      <main className={cx("flex w-full max-w-[480px] flex-col gap-6", desktop ? "px-6 pt-24 pb-12" : "safe-top px-4 pt-16 pb-8")}>
        <span className="text-caption font-medium text-text-tertiary">Step {n} of 2</span>
        {step === "engine" && (
          <EngineStep
            found={setup.found_engines}
            onPick={(id) => {
              setEngine(id);
              setStep("awake");
            }}
          />
        )}
        {step === "awake" && engine && <AwakeStep engine={engine} onDone={closeFirstRun} />}
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
  const engines = useEngineList();
  const [others, setOthers] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<EngineCheck | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const desktop = useDesktop();
  const best = found[0] ?? null;
  const bestInfo = engines?.find((e) => e.id === (best ?? "pi"));
  const rest = (engines ?? []).filter((e) => e.id !== (best ?? "pi"));
  const size = desktop ? "lg" : "phone";

  // Step 1 checks the chosen AI once. When it's ready, straight on to step 2; only a
  // problem stays on screen, with what to do.
  const run = async (id: string) => {
    setPicked(id);
    setResult(null);
    setFailed(null);
    setChecking(true);
    try {
      const c = await checkEngine(id);
      if (c.ready) {
        onPick(id);
        return;
      }
      setResult(c);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "That check didn't work. Try again.");
    } finally {
      setChecking(false);
    }
  };

  if (picked) {
    return (
      <>
        <Heading title="Connect your AI" />
        <CheckCard
          engineId={picked}
          checking={checking}
          result={result}
          failed={failed}
          onRetry={() => void run(picked)}
          onBack={() => {
            setPicked(null);
            setResult(null);
            setFailed(null);
          }}
        />
      </>
    );
  }

  return (
    <>
      <Heading title="Connect your AI" line="Weilo works with the AI app you already use." />
      <Card phone={!desktop} className="flex flex-col gap-4 p-4">
        {best ? (
          <>
            <div className="flex flex-col gap-1">
              <div className="text-title-sm font-semibold">
                We found {engineTitle(best, engines ?? undefined)}
                {bestInfo?.ready && bestInfo.needs == null ? ", signed in" : ""}. Use it?
              </div>
              <div className="text-body-sm text-text-secondary">
                {bestInfo && !bestInfo.ready ? (
                  <TextWithCode text={statusLine(bestInfo)} />
                ) : (
                  "Your agent works through it, with your own sign-in."
                )}
              </div>
            </div>
            <Button variant="primary" size={size} onClick={() => void run(best)}>
              Use it
            </Button>
          </>
        ) : (
          <BuiltIn engines={engines} size={size} onUse={() => void run("pi")} />
        )}
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
              <OtherApp key={e.id} engine={e} last={i === rest.length - 1} onUse={() => void run(e.id)} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/**
 * A row under Other AI apps. One that can't be used yet says what to do in one line and
 * offers Check again, so it's never a dead end.
 */
function OtherApp({ engine: e, last, onUse }: { engine: EngineInfo; last: boolean; onUse(): void }) {
  const desktop = useDesktop();
  const [checking, setChecking] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const ok = canPick(e);
  const again = async () => {
    setChecking(true);
    setLine(null);
    try {
      const c = await checkEngine(e.id);
      await loadEngines();
      if (!c.ready) setLine(c.message);
    } catch (err) {
      setLine(err instanceof Error ? err.message : "That check didn't work. Try again.");
    } finally {
      setChecking(false);
    }
  };
  return (
    <li className={cx("flex min-h-14 items-center gap-3 px-4 py-2", !last && "shadow-line")}>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cx("font-medium", !ok && "text-text-secondary")}>{engineTitle(e.id, [e])}</span>
        <span className="text-caption text-text-secondary" aria-live="polite">
          {checking ? "Checking…" : <TextWithCode text={line ?? engineLine(e)} />}
        </span>
        {!checking && !line && engineHow(e) && (
          <Disclosure label="Details" className="mt-0.5">
            <TextWithCode text={engineHow(e)!} />
          </Disclosure>
        )}
      </span>
      {ok ? (
        <Button size={desktop ? "md" : "phone"} onClick={onUse}>
          Use
        </Button>
      ) : (
        <Button size={desktop ? "md" : "phone"} disabled={checking} onClick={() => void again()}>
          Check again
        </Button>
      )}
    </li>
  );
}

/** No AI app found: Weilo's built-in AI, with a pasted API key (pi is named only in Details). */
function BuiltIn({ engines, size, onUse }: { engines: EngineInfo[] | null; size: "lg" | "phone"; onUse(): void }) {
  const pi = engines?.find((e) => e.id === "pi");
  const form = useKeyForm(pi);
  const saved = !!pi?.key_providers?.some((p) => p.has_key);
  const [changing, setChanging] = useState(false);
  const takesKey = !!pi?.key_providers?.length;
  const showForm = takesKey && (!saved || changing);
  return (
    <>
      <div className="flex flex-col gap-1">
        <div className="text-title-sm font-semibold">Use Weilo's built-in AI</div>
        <div className="text-body-sm text-text-secondary">
          {saved && !changing ? "A key is saved. You're set." : "It works with your own API key."}
        </div>
      </div>
      {showForm ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await form.save()) onUse();
          }}
        >
          <KeyFields form={form} autoFocus />
          {form.error && <ErrorLine>{form.error}</ErrorLine>}
          <Button type="submit" variant="primary" size={size} disabled={form.busy || !form.key.trim()}>
            Save key
          </Button>
        </form>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <Button variant="primary" size={size} className="w-full" onClick={onUse} disabled={!engines}>
            Use it
          </Button>
          {takesKey && (
            <Button variant="tertiary" size="sm" onClick={() => setChanging(true)}>
              Use a different key
            </Button>
          )}
        </div>
      )}
      <details className="group text-caption text-text-secondary">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm font-medium hover:text-text [&::-webkit-details-marker]:hidden">
          <ChevronDownIcon size={12} className="shrink-0 -rotate-90 transition-transform duration-[120ms] group-open:rotate-0" />
          Details
        </summary>
        <p className="m-0 mt-1">It runs pi, an open-source AI app, on this computer. Your key goes only to the company that made it.</p>
      </details>
    </>
  );
}

/** Checking the chosen AI, and when it isn't ready, the plain problem and what to do. */
function CheckCard({
  engineId,
  checking,
  result,
  failed,
  onRetry,
  onBack,
}: {
  engineId: string;
  checking: boolean;
  result: EngineCheck | null;
  failed: string | null;
  onRetry(): void;
  onBack(): void;
}) {
  const engines = useApp((s) => s.engines);
  const engine = engines?.find((e) => e.id === engineId);
  const title = engineTitle(engineId, engines ?? undefined);
  const desktop = useDesktop();
  const size = desktop ? "lg" : "phone";
  const form = useKeyForm(engine);
  const need = result && !result.ready ? needKind(result.needs) ?? problemKind(result.action) : null;
  const takesKey = !!engine?.key_providers?.length;
  const keyForm = (primary: boolean) => (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await form.save()) onRetry();
      }}
    >
      <KeyFields form={form} autoFocus={primary} />
      {form.error && <ErrorLine>{form.error}</ErrorLine>}
      <Button type="submit" variant={primary ? "primary" : "secondary"} size={size} disabled={form.busy || !form.key.trim()}>
        Save key
      </Button>
    </form>
  );
  const help = need === "sign_in" || need === "install" ? helpText(need, title, engine?.how, result ?? undefined) : null;

  return (
    <Card phone={!desktop} className="flex flex-col gap-4 p-4" aria-label={title}>
      <div className="text-title-sm font-semibold">{title}</div>
      {checking && (
        <p role="status" className="m-0 flex items-center gap-2 text-body-sm text-text-secondary">
          <SpinnerIcon className="spin shrink-0 text-accent" />
          Checking {title}… The first time can take a minute.
        </p>
      )}
      {failed && !checking && (
        <>
          <ErrorLine>{failed}</ErrorLine>
          <Button variant="primary" size={size} onClick={onRetry}>
            Try again
          </Button>
        </>
      )}
      {result && !checking && !result.ready && (
        <>
          <ErrorLine>
            <TextWithCode text={result.message} />
          </ErrorLine>
          {need === "key" && takesKey ? (
            keyForm(true)
          ) : (
            <>
              {help && !alreadySays(result.message, help.line) && (
                <p className="m-0 text-body-sm text-text">
                  <TextWithCode text={help.line} />
                </p>
              )}
              {help?.ways && <p className="m-0 text-body-sm text-text-secondary">{help.ways}</p>}
              <Button variant="primary" size={size} onClick={onRetry} autoFocus>
                {need === "retry" || !need ? "Try again" : "Check again"}
              </Button>
              {/* No sign-in here, but an API key works too: paste it instead. */}
              {need === "sign_in" && takesKey && (
                <div className="flex flex-col gap-3 border-t border-border pt-4">
                  <span className="text-body-sm text-text-secondary">Or use an API key instead.</span>
                  {keyForm(false)}
                </div>
              )}
            </>
          )}
        </>
      )}
      {!checking && (
        <Button variant="tertiary" size="sm" className="w-fit" onClick={onBack}>
          Choose another AI
        </Button>
      )}
    </Card>
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
      {error && <ErrorLine>{error}</ErrorLine>}
    </>
  );
}
