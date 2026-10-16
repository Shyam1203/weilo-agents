import { useEffect, useRef, useState, type FormEvent } from "react";
import { answerSignIn, signInStatus, startSignIn, stopSignIn, type Provider, type SignIn as Step } from "../../api/providers";
import { messageOf } from "../../api/http";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { useCopy } from "../../lib/useCopy";

const POLL_MS = 2000;

const pasteHint = (placeholder = "") =>
  /^https?:/.test(placeholder)
    ? "Paste the address of the page you land on."
    : "When you have signed in, copy the code the page shows and paste it here.";

export function SignIn({ provider, onDone, onCancel }: { provider: Provider; onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState<Step>({ state: "working" });
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const { copied, copy } = useCopy();
  const done = useRef(onDone);
  done.current = onDone;

  const take = (next: Step) => {
    setStep(next);
    if (next.state === "done") done.current();
  };
  const fail = (e: unknown) => setError(messageOf(e));

  useEffect(() => {
    void startSignIn(provider.id).then(take, fail);
    return () => void stopSignIn(provider.id).catch(() => {});
  }, [provider.id]);

  const going = !error && (step.state === "working" || step.state === "waiting");
  useEffect(() => {
    if (!going) return;
    const timer = setInterval(() => void signInStatus(provider.id).then(take, fail), POLL_MS);
    return () => clearInterval(timer);
  }, [going, provider.id]);

  const send = async (value: string) => {
    setSending(true);
    setError(null);
    try {
      take(await answerSignIn(provider.id, value));
      setAnswer("");
    } catch (e) {
      fail(e);
    } finally {
      setSending(false);
    }
  };
  const submit = (e: FormEvent) => (e.preventDefault(), void send(answer));

  const ask = step.ask;
  const failed = error ?? (step.state === "failed" ? step.message : null);
  return (
    <div className="flex flex-col gap-3 rounded-xl p-3.5 ring-1 ring-line-strong">
      <p className="text-[13px] font-medium">Sign in with {provider.signIn}</p>
      {step.state === "working" && !failed && (
        <p className="flex items-center gap-2 text-[13px] text-ink-2">
          <Icon name="spinner" size={14} /> {step.message ?? "Starting…"}
        </p>
      )}
      {step.code && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-ink-2">Open the sign-in page and type this code:</p>
          <div className="flex items-center gap-2">
            <code className="rounded-lg bg-card px-3 py-1.5 font-mono text-[17px] tracking-[0.15em]">{step.code}</code>
            <Button size="sm" variant="ghost" icon={copied ? "check" : "copy"} onClick={() => void copy(step.code!)}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
      {step.url && !failed && (
        <a href={step.url} target="_blank" rel="noreferrer noopener" className="inline-flex h-8 w-fit items-center gap-1.5 rounded-xl bg-ink px-2.5 text-[13px] font-medium text-page shadow-sm hover:opacity-90">
          Open the sign-in page <Icon name="external" size={13} />
        </a>
      )}
      {step.code && !ask && !failed && (
        <p className="flex items-center gap-2 text-xs text-ink-3">
          <Icon name="spinner" size={12} /> Waiting for you to approve it there…
        </p>
      )}
      {ask?.type === "select" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] text-ink-2">{ask.message}</p>
          {ask.options?.map((o) => (
            <Button key={o.id} size="sm" className="justify-start" disabled={sending} onClick={() => void send(o.id)}>
              {o.label}
            </Button>
          ))}
        </div>
      )}
      {ask && ask.type !== "select" && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <p className="text-[13px] text-ink-2">{ask.type === "paste" ? pasteHint(ask.placeholder) : ask.message}</p>
          <input
            autoFocus={ask.type !== "paste"}
            type={ask.type === "secret" ? "password" : "text"}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={ask.type === "paste" ? (/^https?:/.test(ask.placeholder ?? "") ? "The page's address" : "The code") : ask.placeholder}
            aria-label={ask.message}
            className="input"
          />
          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="sm" busy={sending} disabled={ask.type === "paste" && !answer.trim()}>
              Continue
            </Button>
          </div>
        </form>
      )}
      <ErrorText>{failed}</ErrorText>
      <div className="flex justify-end gap-2">
        {failed && (
          <Button size="sm" onClick={() => (setError(null), setStep({ state: "working" }), void startSignIn(provider.id).then(take, fail))}>
            Try again
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
