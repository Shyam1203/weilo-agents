import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { queue, send, setComposerDraft, unqueue } from "../../lib/app";
import { cx } from "../../lib/format";
import { hostAway, useApp, type Queued } from "../../lib/store";
import { Button } from "../../ui/Button";
import { ChevronDownIcon, CloseIcon, SendIcon } from "../../ui/glyphs";
import { IconButton } from "../../ui/IconButton";
import { Menu, MenuItem } from "../../ui/Menu";
import { takeComposerFocus } from "./useThread";
import { useTouchOnly } from "../../lib/platform";

const NO_QUEUE: Queued[] = [];
const MAX_LINES = 6;

export interface ComposerProps {
  threadId: string;
  placeholder: string;
  label: string;
  working: boolean;
  /** "Ava": for "Ava is working · Stop Ava". */
  agentName: string | null;
  onStop(): void;
  /** Replaces the working hint (sessions: "⌘. stops the session · about $0.38 so far"). */
  hint?: ReactNode;
  phone?: boolean;
}

/** The message box: a textarea on its own row, send on a toolbar row beneath it. */
export function Composer({ threadId, placeholder, label, working, agentName, onStop, hint, phone }: ComposerProps) {
  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const ref = useRef<HTMLTextAreaElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const queued = useApp((s) => s.queued[threadId] ?? NO_QUEUE);
  const touch = useTouchOnly();
  const draft = useApp((s) => s.drafts[threadId]);
  // While the Weilo computer says it isn't ready, typing works but sending waits.
  const paused = useApp((s) => s.paused);
  const away = useApp(hostAway);

  // Text handed over by Edit or Ask Ava.
  useEffect(() => {
    if (!draft) return;
    setText(draft);
    setComposerDraft(threadId, "");
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [draft, threadId]);

  useEffect(() => {
    const onFocus = () => ref.current?.focus();
    // Asked for before this box was on screen (Search → Enter opens a new page).
    if (takeComposerFocus()) onFocus();
    window.addEventListener("weilo:focus-composer", onFocus);
    return () => window.removeEventListener("weilo:focus-composer", onFocus);
  }, []);

  // Grow from 1 to 6 lines.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_LINES)}px`;
  }, [text]);

  const empty = !text.trim();
  const blocked = empty || paused !== null;
  const sendNow = useCallback(() => {
    if (!text.trim() || paused) return;
    void send(threadId, text, "now");
    setText("");
  }, [text, threadId, paused]);
  const afterJob = useCallback(() => {
    if (!text.trim() || paused) return;
    if (working) queue(threadId, text);
    else void send(threadId, text, "now");
    setText("");
    setMenu(false);
    ref.current?.focus();
  }, [text, threadId, working, paused]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    if (phone && !e.altKey) return; // phones: Enter is a new line; the button sends
    e.preventDefault();
    if (e.altKey) afterJob();
    else sendNow();
  };

  const edit = (q: Queued) => {
    unqueue(threadId, q.id);
    setText(q.text);
    ref.current?.focus();
  };

  const chips = queued.length > 0 && (
    <div className="flex flex-wrap gap-1">
      {queued.map((q) => (
        <span
          key={q.id}
          className="flex h-6 max-w-full min-w-0 items-center gap-2 rounded-sm bg-surface-muted pr-1 pl-2 text-caption text-text-secondary max-md:h-11"
        >
          <span className="ellipsis">Next up: “{q.text}”</span>
          <button
            type="button"
            onClick={() => edit(q)}
            className="shrink-0 border-0 bg-transparent p-0 font-medium text-accent-text hover:underline"
          >
            Edit
          </button>
          <IconButton label="Remove from next up" size={phone ? 44 : 24} onClick={() => unqueue(threadId, q.id)}>
            <CloseIcon size={12} />
          </IconButton>
        </span>
      ))}
    </div>
  );

  // While the computer is away, "Stop Ava" couldn't reach it: say nothing rather than offer it.
  const workingHint = working && !away && (
    <>
      <span>{agentName ? `${agentName} is working` : "This session is working"}</span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        onClick={onStop}
        className="-mx-0.5 h-6 border-0 bg-transparent px-0.5 text-caption font-medium text-text-secondary underline underline-offset-2 max-md:h-11"
      >
        {agentName ? `Stop ${agentName}` : "Stop"}
      </button>
      {!phone && !touch && (
        <>
          <span aria-hidden="true">·</span>
          <span>Enter: Tell now · Alt+Enter: After this job</span>
        </>
      )}
    </>
  );
  const sendMenu = (
    <Menu open={menu} onClose={closeMenu} anchor={menuButton} label="Send options" prefer="above" className="w-56">
      <MenuItem onSelect={afterJob} disabled={blocked}>
        <span className="flex-1">After this job</span>
        {!phone && !touch && <span className="text-caption text-text-tertiary">Alt+Enter</span>}
      </MenuItem>
    </Menu>
  );
  const hintLine = hint ?? workingHint;

  if (phone) {
    return (
      <div className="flex flex-col gap-1">
        {chips}
        <div className="ring-within flex min-h-12 items-end gap-2 rounded-[24px] border border-border-strong bg-surface py-0.5 pr-0.5 pl-4">
          <textarea
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            placeholder={placeholder}
            aria-label={label}
            data-composer=""
            className="my-2.5 min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-phone text-text outline-none"
          />
          <button
            type="button"
            onClick={sendNow}
            disabled={blocked}
            aria-label={working ? "Tell now" : "Send"}
            title={paused ?? undefined}
            className="flex size-11 shrink-0 items-center justify-center rounded-full border-0 bg-accent text-on-accent disabled:bg-surface-muted disabled:text-text-tertiary"
          >
            <SendIcon size={20} />
          </button>
          {working && (
            <IconButton
              ref={menuButton}
              label="More ways to send"
              size={44}
              aria-haspopup="menu"
              aria-expanded={menu}
              disabled={paused !== null}
              onClick={() => setMenu((v) => !v)}
              className="rounded-full"
            >
              <ChevronDownIcon size={16} />
            </IconButton>
          )}
          {working && sendMenu}
        </div>
        {hintLine && <div className="flex flex-wrap items-center gap-1.5 px-1 text-caption text-text-tertiary">{hintLine}</div>}
      </div>
    );
  }

  return (
    <div>
      <div className="ring-within flex flex-col gap-2 rounded-lg border border-border-strong bg-surface p-3 shadow-e1">
        {chips}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder}
          aria-label={label}
          data-composer=""
          className="block w-full resize-none border-0 bg-transparent p-0 text-body text-text outline-none"
        />
        <div className="flex items-center gap-1">
          <div className="flex-1" />
          {working ? (
            <div className="relative flex">
              <Button
                variant="primary"
                className="rounded-r-none"
                onClick={sendNow}
                aria-disabled={blocked}
                disabled={paused !== null}
                title={paused ?? "Enter"}
              >
                Tell now
              </Button>
              <button
                ref={menuButton}
                type="button"
                aria-label="More ways to send"
                aria-haspopup="menu"
                aria-expanded={menu}
                disabled={paused !== null}
                title={paused ?? undefined}
                onClick={() => setMenu((v) => !v)}
                className="flex h-8 w-7 items-center justify-center rounded-r-md border-0 bg-accent p-0 text-on-accent shadow-[inset_1px_0_0_var(--on-accent-divider)] hover:bg-accent-hover disabled:opacity-50 disabled:hover:bg-accent"
              >
                <ChevronDownIcon size={12} />
              </button>
              {sendMenu}
            </div>
          ) : (
            <Button variant="primary" onClick={sendNow} aria-disabled={blocked} disabled={paused !== null} title={paused ?? "Enter"}>
              Send
            </Button>
          )}
        </div>
      </div>
      {hintLine && (
        <div className={cx("flex flex-wrap items-center gap-1.5 px-1 pt-2 text-caption text-text-tertiary")}>{hintLine}</div>
      )}
    </div>
  );
}
