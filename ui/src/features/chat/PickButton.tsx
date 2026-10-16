import { Icon } from "../../components/ui/Icon";

interface Props {
  label: string;
  done?: string;
  picked?: boolean;
  onPick?: () => void;
  /** The key that picks it, shown where there is a keyboard. */
  shortcut?: string;
}

export function PickButton({ label, done = label, picked = false, onPick, shortcut }: Props) {
  return (
    <button
      type="button"
      disabled={!onPick}
      aria-pressed={picked}
      onClick={onPick}
      className={`rounded-lg border px-3.5 py-1.5 text-[13.5px] transition-colors disabled:pointer-events-none ${picked ? "border-ink bg-page font-medium text-ink ring-1 ring-ink" : "border-line-strong bg-page hover:bg-select disabled:opacity-50"}`}
    >
      {shortcut && !picked && <kbd className="mr-1.5 hidden font-sans text-xs text-ink-3 pointer-fine:inline">{shortcut}</kbd>}
      {picked && <Icon name="check" size={13} className="mr-1 inline align-[-0.12em]" />}
      {picked ? done : label}
    </button>
  );
}
