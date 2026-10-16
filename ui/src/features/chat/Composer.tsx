import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { doingText } from "../../api/agents";
import type { Outgoing } from "../../api/chat";
import { messageOf } from "../../api/http";
import { Avatar, type AvatarSpec } from "../../components/ui/Avatar";
import { Icon, type IconName } from "../../components/ui/Icon";
import { Menu, MenuItem } from "../../components/ui/Menu";
import { matches } from "../../components/ui/Search";
import { toImageDataUrl } from "../../lib/attachments";
import { finePointer, isFreeKey } from "../../lib/keys";
import { MAX_FILE_MB, MAX_FILES, MAX_IMAGES } from "../../lib/limits";
import { draftKey, read, write } from "../../lib/storage";
import { useDictation } from "../../lib/useDictation";
import { CameraDialog } from "./CameraDialog";
import { COMMAND_LIST, CommandMenu, type Shortcut } from "./CommandMenu";
import { continueList } from "./lists";

const MAX_HEIGHT = 200;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
// Dictated words go after what is typed, with a space between.
const joined = (typed: string, heard: string) => (typed && !/\s$/.test(typed) ? `${typed} ${heard}` : typed + heard);

export interface Draft {
  text: string;
  images: string[];
}

interface Props {
  agentId: string;
  onEdit: () => void;
  shortcuts: Shortcut[];
  to: string;
  avatar: AvatarSpec;
  doing?: string | null;
  busy: boolean;
  waiting: boolean;
  onAnswer?: (value: string) => Promise<void>;
  disabled: boolean;
  onSend: (message: Outgoing) => Promise<void>;
  onStop: () => void;
  meter?: ReactNode;
  /** Put this in the box, replacing what is there (a new object each time). */
  fill?: Draft | null;
  /** What ↑ brings back in an empty box: your last message. */
  last?: Draft;
}

export function Composer({ agentId, onEdit, shortcuts, to, avatar, doing, busy, waiting, onAnswer, disabled, onSend, onStop, meter, fill, last }: Props) {
  const [text, setText] = useState(() => read(draftKey(agentId)) ?? "");
  const [focused, setFocused] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const [active, setActive] = useState(0);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const typing = /^\/([^\s/]*)$/.exec(text)?.[1];
  const open = typing !== undefined && closedFor !== text;
  const offered = open ? shortcuts.filter((s) => matches(typing.replace(/^skill:/, ""), s.label, s.group)) : [];
  const highlighted = Math.min(active, offered.length - 1);
  const hint = open && !offered.length ? (shortcuts.length ? "No match." : "No skills or plugins are on for this agent.") : undefined;
  const dictation = useDictation((heard) => setText((current) => joined(current, heard)));

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
      el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
    };
    fit();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => el.clientWidth !== width && ((width = el.clientWidth), fit()));
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, dictation.interim]);

  useEffect(() => write(draftKey(agentId), text.trim() ? text : null), [agentId, text]);

  const put = (draft: Draft) => {
    setText(draft.text);
    setImages(draft.images);
    setFiles([]);
    setError(null);
    caret.current = draft.text.length;
    box.current?.focus();
  };
  useEffect(() => void (fill && put(fill)), [fill]);

  useEffect(() => {
    if (finePointer()) box.current?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key.length === 1 && event.key !== " " && isFreeKey(event)) box.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useLayoutEffect(() => {
    if (caret.current !== null && box.current) box.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [text]);

  const attach = async (picked: File[]) => {
    setError(null);
    const pictures = picked.filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
    const others = picked.filter((f) => !pictures.includes(f));
    const fits = others.filter((f) => f.size <= MAX_FILE_BYTES).slice(0, MAX_FILES - files.length);
    setFiles((list) => [...list, ...fits]);
    const tooBig = others.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) setError(`${tooBig.name} is too large. The maximum is ${MAX_FILE_MB} MB.`);
    else if (fits.length < others.length) setError(`A message can have a maximum of ${MAX_FILES} files.`);

    const room = MAX_IMAGES - images.length;
    if (pictures.length > room) setError(`A message can have a maximum of ${MAX_IMAGES} images.`);
    try {
      const added = await Promise.all(pictures.slice(0, Math.max(room, 0)).map(toImageDataUrl));
      setImages((list) => [...list, ...added]);
    } catch (e) {
      setError(messageOf(e));
    }
  };

  const hasContent = !!text.trim() || images.length > 0 || files.length > 0;

  const submit = async (event?: FormEvent, when: "now" | "later" = "now") => {
    event?.preventDefault();
    if (!hasContent || sending || disabled) return;
    dictation.stop();
    const sent = { text: text.trim(), images, files };
    setSending(true);
    setError(null);
    try {
      if (onAnswer && sent.text && !images.length && !files.length) await onAnswer(sent.text);
      else await onSend({ ...sent, when });
      setText("");
      setImages([]);
      setFiles([]);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSending(false);
      box.current?.focus();
    }
  };

  const pick = (shortcut: Shortcut) => {
    setText(shortcut.insert);
    box.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (offered.length) {
      const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
      if (step) {
        event.preventDefault();
        return setActive((i) => (i + step + offered.length) % offered.length);
      }
      const chosen = offered[highlighted];
      const typedOut = event.key === "Enter" && text.trim() === chosen.insert.trim();
      if ((event.key === "Enter" || event.key === "Tab") && !typedOut) {
        event.preventDefault();
        return pick(chosen);
      }
      if (event.key === "Escape") return setClosedFor(text);
    }
    if (event.key === "Escape" && busy && !waiting) {
      event.preventDefault();
      return onStop();
    }
    if (event.key === "ArrowUp" && !hasContent && last && (last.text || last.images.length)) {
      event.preventDefault();
      return put(last);
    }
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    const newLine = event.shiftKey || !finePointer();
    if (!newLine) {
      event.preventDefault();
      return void submit(undefined, busy && event.altKey ? "later" : "now");
    }
    const el = event.currentTarget;
    const next = el.selectionStart === el.selectionEnd ? continueList(el.value, el.selectionStart) : null;
    if (next) {
      event.preventDefault();
      caret.current = next.caret;
      setText(next.text);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...event.clipboardData.files];
    if (!pasted.length) return;
    event.preventDefault();
    void attach(pasted);
  };

  const onDrop = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDragging(false);
    void attach([...event.dataTransfer.files]);
  };

  const note = error ?? dictation.error ?? (dictation.listening ? "Listening… Tap the microphone to stop." : null);
  const keys = busy && hasContent && !onAnswer ? "Enter tells it now · Alt+Enter sends it when it finishes" : waiting ? "Enter to send your answer" : busy ? "Enter to send · Esc to stop" : "Enter to send · Shift+Enter for a new line · / for commands · ↑ for your last message";

  return (
    <form
      onSubmit={submit}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className="relative flex flex-col"
    >
      {open && <CommandMenu shortcuts={offered} active={highlighted} onPick={pick} hint={hint} onEdit={shortcuts.length ? undefined : onEdit} />}
      {busy && (
        <p role="status" className="absolute bottom-full left-3 mb-1.5 flex animate-rise items-center gap-1.5 rounded-full bg-raised py-0.5 pr-2.5 pl-0.5 text-xs text-ink-2 ring-1 ring-line">
          <Avatar spec={avatar} size={26} working doing={doing} />
          <span key={waiting ? "waiting" : doingText(doing)} className="working-dots animate-text-swap">
            {waiting ? "Waiting for your answer" : doingText(doing)}<span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
          {!waiting && (
            <button type="button" onClick={onStop} title="Stop (Esc)" className="ml-1 rounded-full px-1.5 font-medium text-ink hover:bg-select">
              Stop
            </button>
          )}
        </p>
      )}
      <div className={`flex flex-col rounded-2xl border bg-page transition-colors focus-within:border-ink-3 ${dragging ? "border-dashed border-ink-2" : waiting ? "border-ink-2 ring-2 ring-ink-3/30" : "border-line-strong"}`}>
        {(files.length > 0 || images.length > 0) && (
          <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Attachments">
            {images.map((url, i) => (
              <li key={url.slice(-24) + i} className="relative">
                <img src={url} alt={`Attachment ${i + 1}`} className="size-14 rounded-xl object-cover" />
                <RemoveButton label={`Remove image ${i + 1}`} onClick={() => setImages((list) => list.filter((_, j) => j !== i))} />
              </li>
            ))}
            {files.map((file, i) => (
              <li key={file.name + i} className="relative flex h-14 max-w-48 items-center gap-2 rounded-xl bg-card px-3 text-xs">
                <Icon name="attach" size={14} className="shrink-0 text-ink-3" />
                <span className="truncate">{file.name}</span>
                <RemoveButton label={`Remove ${file.name}`} onClick={() => setFiles((list) => list.filter((_, j) => j !== i))} />
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-1.5 p-1.5">
          <input
            ref={picker}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void attach([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <Menu placement="above-start" trigger={({ open, toggle }) => <RoundButton icon="plus" label="Add files and photos" open={open} disabled={disabled} onClick={toggle} />}>
            {(close) => (
              <>
                <MenuItem icon="attach" label="Files and photos" onClick={() => (close(), picker.current?.click())} />
                <MenuItem icon="camera" label="Camera" onClick={() => (close(), setCamera(true))} />
                {shortcuts.length > 0 && <MenuItem icon="sparkle" label="Skills and commands" onClick={() => (close(), setText("/"), box.current?.focus())} />}
              </>
            )}
          </Menu>
          <textarea
            ref={box}
            rows={1}
            value={dictation.listening && dictation.interim ? joined(text, dictation.interim) : text}
            onChange={(e) => (setText(e.target.value), setActive(0), setError(null))}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={disabled}
            readOnly={dictation.listening && !!dictation.interim}
            placeholder={dragging ? "Drop files to attach" : onAnswer ? "Type your answer" : `Message ${to}`}
            aria-label={onAnswer ? "Your answer" : `Message ${to}`}
            role="combobox"
            aria-expanded={offered.length > 0}
            aria-controls={offered.length ? COMMAND_LIST : undefined}
            aria-activedescendant={offered.length ? `${COMMAND_LIST}-${highlighted}` : undefined}
            className="block min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] leading-6 outline-none placeholder:truncate placeholder:text-ink-3 focus-visible:outline-none"
          />
          {meter}
          {busy && hasContent && !onAnswer && <RoundButton icon="clock" label="Send when it finishes" disabled={sending || disabled} onClick={() => void submit(undefined, "later")} />}
          {busy && !hasContent ? (
            <RoundButton icon="stop" label="Stop" solid onClick={onStop} />
          ) : hasContent || !dictation.supported ? (
            <RoundButton icon={sending ? "spinner" : "arrowUp"} label="Send" solid type="submit" disabled={!hasContent || sending || disabled} />
          ) : (
            <RoundButton icon="mic" label={dictation.listening ? "Stop voice typing" : "Voice typing"} solid={!dictation.listening} active={dictation.listening} disabled={disabled} onClick={dictation.toggle} />
          )}
        </div>
      </div>
      {note ? <p className={`px-4 text-xs ${error || dictation.error ? "text-bad" : "text-ink-3"}`}>{note}</p> : focused && <p className="hidden truncate px-4 text-[11px] text-ink-3 pointer-fine:block">{keys}</p>}
      {camera && <CameraDialog onCapture={(file) => void attach([file])} onClose={() => setCamera(false)} />}
    </form>
  );
}

function RoundButton({ icon, label, solid = false, active = false, open = false, type = "button", disabled, onClick }: { icon: IconName; label: string; solid?: boolean; active?: boolean; open?: boolean; type?: "button" | "submit"; disabled?: boolean; onClick?: () => void }) {
  const [last, setLast] = useState(icon);
  const [swapped, setSwapped] = useState(false);
  if (icon !== last) (setLast(icon), setSwapped(true));
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      aria-expanded={open || undefined}
      disabled={disabled}
      onClick={onClick}
      className={`relative flex size-9 shrink-0 items-center justify-center rounded-lg transition-[opacity,background-color] disabled:opacity-30 ${
        active ? "bg-bad-soft text-bad" : open ? "bg-select text-ink" : solid ? "bg-ink text-page hover:opacity-85" : "bg-card text-ink-2 hover:text-ink"
      }`}
    >
      <span key={icon} className={`flex ${swapped ? "animate-swap" : ""}`}>
        <Icon name={icon} size={icon === "stop" ? 13 : 17} className={`transition-transform ${open ? "rotate-45" : ""}`} />
      </span>
      {active && <span className="absolute top-1.5 right-1.5 size-1.5 animate-pulse rounded-full bg-bad" />}
    </button>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-ink text-page shadow-pop">
      <Icon name="close" size={11} />
    </button>
  );
}
