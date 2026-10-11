// A question the agent asks with the `ask` tool: a choice, or a line of text. Open, it waits for
// your answer; answered, it stays in the chat with the answer marked.
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { useAction } from "../../lib/useAction";
import { PickButton } from "./PickButton";

interface Props {
  question: string;
  options?: string[];
  /** Your answer, once given. */
  answer?: string;
  /** Sends the answer; no value skips the question. Absent when the card is not open. */
  onAnswer?: (value?: string) => Promise<void>;
}

export function AskCard({ question, options, answer, onAnswer }: Props) {
  const { busy, error, run } = useAction();
  const [text, setText] = useState("");
  const send = (value?: string) => run("answer", () => onAnswer!(value));

  return (
    <section className="w-full max-w-md rounded-2xl border border-line bg-page px-3.5 py-3">
      <p className="text-[14.5px] font-medium [overflow-wrap:anywhere]">{question}</p>
      {options?.length ? (
        <>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {options.map((o) => (
              <PickButton key={o} label={o} picked={answer === o} onPick={onAnswer && !busy ? () => void send(o) : undefined} />
            ))}
          </div>
          {/* An answer typed in the message box, not one of the choices. */}
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
