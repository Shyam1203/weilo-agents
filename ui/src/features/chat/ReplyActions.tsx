import { Icon, type IconName } from "../../components/ui/Icon";
import { useCopy } from "../../lib/useCopy";

interface Props {
  text: string;
  onRetry?: () => void;
}

export function ReplyActions({ text, onRetry }: Props) {
  const { copied, copy } = useCopy();
  const canShare = typeof navigator.share === "function";
  return (
    <div className="mt-0.5 flex gap-0.5 pl-1 text-ink-3">
      <Action icon={copied ? "check" : "copy"} label={copied ? "Copied" : "Copy"} onClick={() => void copy(text)} />
      {canShare && <Action icon="share" label="Share" onClick={() => void navigator.share({ text }).catch(() => {})} />}
      {onRetry && <Action icon="retry" label="Send your message again" onClick={onRetry} />}
    </div>
  );
}

function Action({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="rounded-md p-1.5 transition-colors hover:bg-select hover:text-ink">
      <Icon name={icon} size={15} />
    </button>
  );
}
