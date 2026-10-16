import { Icon, type IconName } from "../../components/ui/Icon";
import { clockTime, fullWhen } from "../../lib/format";
import { useCopy } from "../../lib/useCopy";

interface Props {
  text: string;
  onRetry?: () => void;
  at?: number | null;
}

export function ReplyActions({ text, onRetry, at }: Props) {
  const { copied, copy } = useCopy();
  const canShare = typeof navigator.share === "function";
  return (
    <div className="mt-0.5 flex items-center gap-0.5 pl-1 text-ink-3">
      {at ? <Time at={at} className="mr-1" /> : null}
      <Action icon={copied ? "check" : "copy"} label={copied ? "Copied" : "Copy"} onClick={() => void copy(text)} />
      {canShare && <Action icon="share" label="Share" onClick={() => void navigator.share({ text }).catch(() => {})} />}
      {onRetry && <Action icon="retry" label="Send your message again" onClick={onRetry} />}
    </div>
  );
}

export function Time({ at, className = "" }: { at: number; className?: string }) {
  return (
    <time dateTime={new Date(at * 1000).toISOString()} title={fullWhen(at)} className={`text-[11px] tabular-nums ${className}`}>
      {clockTime(at)}
    </time>
  );
}

export function Action({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="rounded-md p-1.5 transition-colors hover:bg-select hover:text-ink">
      <Icon name={icon} size={15} />
    </button>
  );
}
