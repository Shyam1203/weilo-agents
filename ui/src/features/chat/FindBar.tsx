import { IconButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { MAX_SEARCH } from "../../lib/limits";

interface Props {
  query: string;
  onQuery: (query: string) => void;
  count: number;
  current: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

export function FindBar({ query, onQuery, count, current, onNext, onPrevious, onClose }: Props) {
  return (
    <div role="search" className="flex shrink-0 items-center gap-1.5 border-b border-line py-1.5 pr-2 pl-4">
      <Icon name="search" size={15} className="shrink-0 text-ink-3" />
      <input
        autoFocus
        type="text"
        enterKeyHint="search"
        value={query}
        maxLength={MAX_SEARCH}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.preventDefault(), e.shiftKey ? onPrevious() : onNext());
          if (e.key === "Escape") (e.preventDefault(), onClose());
        }}
        placeholder="Find in this chat"
        aria-label="Find in this chat"
        className="min-w-0 flex-1 bg-transparent py-1.5 text-[14px] outline-none placeholder:text-ink-3"
      />
      {query.trim() && <span className="shrink-0 text-xs text-ink-3 tabular-nums">{count ? `${current + 1} of ${count}` : "No matches"}</span>}
      <IconButton icon="chevronDown" label="Previous match" onClick={onPrevious} disabled={!count} className="rotate-180" />
      <IconButton icon="chevronDown" label="Next match" onClick={onNext} disabled={!count} />
      <IconButton icon="close" label="Close find" onClick={onClose} />
    </div>
  );
}
