import { doingText } from "../../api/agents";
import { Avatar, type AvatarSpec } from "../../components/ui/Avatar";

export function WorkingPill({ avatar, doing, waiting, summarizing = false, onStop }: { avatar: AvatarSpec; doing?: string | null; waiting: boolean; summarizing?: boolean; onStop: () => void }) {
  const text = waiting ? "Waiting for your answer" : doingText(summarizing ? null : doing);
  return (
    <p role="status" className="flex w-fit animate-rise items-center gap-1.5 rounded-full bg-raised py-0.5 pr-2.5 pl-0.5 text-xs text-ink-2 ring-1 ring-line">
      <Avatar spec={avatar} size={26} working doing={doing} />
      <span key={text} className="working-dots animate-text-swap">
        {text}
        <Dots />
      </span>
      {!waiting && !summarizing && (
        <button type="button" onClick={onStop} title="Stop (Esc twice)" className="ml-1 rounded-full px-1.5 font-medium text-ink hover:bg-select">
          Stop
        </button>
      )}
    </p>
  );
}

export const Dots = () => (
  <>
    <span aria-hidden="true">.</span>
    <span aria-hidden="true">.</span>
    <span aria-hidden="true">.</span>
  </>
);
