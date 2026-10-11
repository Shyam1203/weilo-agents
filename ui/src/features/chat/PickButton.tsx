import { Icon } from "../../components/ui/Icon";

interface Props {
  label: string;
  /** What it says once picked. */
  done?: string;
  picked?: boolean;
  /** Absent when it can no longer be picked. */
  onPick?: () => void;
}

/** A round choice button; the one picked stays marked with an outline and a check. */
export function PickButton({ label, done = label, picked = false, onPick }: Props) {
  return (
    <button
      type="button"
      disabled={!onPick}
      aria-pressed={picked}
      onClick={onPick}
      className={`rounded-lg border px-3.5 py-1.5 text-[13.5px] transition-colors disabled:pointer-events-none ${picked ? "border-ink bg-page font-medium text-ink ring-1 ring-ink" : "border-line-strong bg-page hover:bg-select disabled:opacity-50"}`}
    >
      {picked && <Icon name="check" size={13} className="mr-1 inline align-[-0.12em]" />}
      {picked ? done : label}
    </button>
  );
}
