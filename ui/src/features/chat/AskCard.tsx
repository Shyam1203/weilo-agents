import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { isFreeKey } from "../../lib/keys";
import { useAction } from "../../lib/useAction";
import { PickButton } from "./PickButton";

interface Props {
  question: string;
  options?: string[];
  answer?: string;
  onAnswer?: (value?: string) => Promise<void>;
}

export function AskCard({ question, options, answer, onAnswer }: Props) {
  const { busy, error, run } = useAction();
  const [text, setText] = useState("");
  const send = (value?: string) => run("answer", () => onAnswer!(value));
  const pick = useRef<(key: string) => boolean>(() => false);
  pick.current = (key) => {
    const option = options?.[Number(key) - 1];
    if (!onAnswer || busy || !option || !/^[1-9]$/.test(key)) return false;
    void send(option);
    return true;
  };
  useEffect(() => {
    if (!onAnswer || !options?.length) return;
    // Number keys pick an option, also from an empty message box; capture runs before the box takes focus.
    const onKey = (event: KeyboardEvent) => {
      const box = event.target as HTMLTextAreaElement | null;
      const emptyBox = box?.tagName === "TEXTAREA" && !box.value && !event.ctrlKey && !event.metaKey && !event.altKey;
      if ((isFreeKey(event) || emptyBox) && pick.current(event.key)) event.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [!!onAnswer, options?.length]);

  return (
    <section className={`w-full max-w-md rounded-2xl border bg-page px-3.5 py-3 ${onAnswer ? "border-ink-3 shadow-pop" : "border-line"}`}>
      <p className="max-h-80 overflow-y-auto text-[14.5px] font-medium whitespace-pre-wrap [overflow-wrap:anywhere]">{question}</p>
      {options?.length ? (
        <>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {options.map((o, i) => (
              <PickButton key={o} label={o} picked={answer === o} onPick={onAnswer && !busy ? () => void send(o) : undefined} shortcut={onAnswer && i < 9 ? String(i + 1) : undefined} />
            ))}
          </div>
          {onAnswer && <p className="mt-2 text-xs text-ink-3">Or type your own answer in the message box.</p>}
          {answer !== undefined && !options.includes(answer) && <p className="mt-2 rounded-xl bg-card px-3 py-2 text-[14px] whitespace-pre-wrap [overflow-wrap:anywhere]">{answer}</p>}
        </>
      ) : answer !== undefined ? (
        <p className="mt-2 rounded-xl bg-card px-3 py-2 text-[14px] [overflow-wrap:anywhere]">{answer}</p>
      ) : (
        onAnswer && (
          <form
            className="mt-2.5 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) void send(text.trim());
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Your answer" autoFocus className="input min-w-0 flex-1" />
            <Button type="submit" variant="primary" busy={!!busy} disabled={!text.trim()}>
              Send
            </Button>
          </form>
        )
      )}
      {onAnswer && (
        <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void send()} className="mt-2 -ml-2.5">
          Skip
        </Button>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
