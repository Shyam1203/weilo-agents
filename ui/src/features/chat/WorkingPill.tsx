import { doingText } from "../../api/agents";
import { Avatar, type AvatarSpec } from "../../components/ui/Avatar";

export function WorkingPill({ avatar, doing, waiting, onStop }: { avatar: AvatarSpec; doing?: string | null; waiting: boolean; onStop: () => void }) {
  return (
    <p role="status" className="flex w-fit animate-rise items-center gap-1.5 rounded-full bg-raised py-0.5 pr-2.5 pl-0.5 text-xs text-ink-2 ring-1 ring-line">
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
  );
}
