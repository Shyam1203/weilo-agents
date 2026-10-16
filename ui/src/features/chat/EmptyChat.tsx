import { Avatar, type AvatarSpec } from "../../components/ui/Avatar";
import { Icon } from "../../components/ui/Icon";
import type { Shortcut } from "./CommandMenu";

const SHOWN = 4;

interface Props {
  name: string;
  avatar: AvatarSpec;
  shortcuts: Shortcut[];
  onPick: (text: string) => void;
}

/** A new chat: who you are talking to and a few ways to start, put in the message box to finish. */
export function EmptyChat({ name, avatar, shortcuts, onPick }: Props) {
  const starts = [
    { label: "What can you help me with?", description: "Ask what it can do", insert: "What can you help me with?", icon: "sparkle" as const },
    ...shortcuts.filter((s) => s.group !== "Commands"),
  ].slice(0, SHOWN);
  return (
    <div className="flex animate-rise flex-col items-center pt-[12vh] text-center">
      <Avatar spec={avatar} size={56} />
      <h2 className="mt-4 text-[19px] font-semibold tracking-tight">Chat with {name}</h2>
      <p className="mt-1 text-sm text-ink-3">Ask anything, or start with one of these.</p>
      <ul className="mt-6 grid w-full max-w-lg gap-2 sm:grid-cols-2">
        {starts.map((s) => (
          <li key={s.label}>
            <button type="button" onClick={() => onPick(s.insert)} className="flex h-full w-full items-start gap-2.5 rounded-xl border border-line px-3 py-2.5 text-left transition-colors hover:bg-select">
              <Icon name={s.icon} size={15} className="mt-0.5 shrink-0 text-ink-3" />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px]">{s.label}</span>
                {s.description && <span className="line-clamp-2 text-xs text-ink-3">{s.description}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
