import type { ReactNode } from "react";
import type { Pin } from "../../api/pins";
import { IconButton } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { Loading } from "../../components/ui/List";

export type Tab = "pins" | "actions";

interface Props {
  tab: Tab;
  onTab: (tab: Tab) => void;
  pins: Pin[] | null;
  pinsError: string | null;
  /** A pin changed since you last looked. */
  fresh: boolean;
  actionCount: number;
  agentName: string;
  /** Each pin's card. */
  cards: (pin: Pin) => ReactNode;
  /** The actions list. */
  actions: ReactNode;
  onNew?: () => void;
}

/** The bolt's panel: pins the agent keeps up to date, and actions, as two tabs. */
export function SidePanel({ tab, onTab, pins, pinsError, fresh, actionCount, agentName, cards, actions, onNew }: Props) {
  const tabButton = (which: Tab, label: string, count: number, dot = false) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === which}
      onClick={() => onTab(which)}
      className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13.5px] transition-colors ${tab === which ? "bg-page font-semibold text-ink shadow-sm" : "font-medium text-ink-3 hover:text-ink-2"}`}
    >
      {label}
      {count > 0 && <span className="font-normal text-ink-3">{count}</span>}
      {dot && <span aria-label="Changed" className="size-1.5 rounded-full bg-good" />}
    </button>
  );
  return (
    <section className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label="Pins and actions" className="flex flex-1 gap-0.5 rounded-xl bg-card p-0.5">
          {tabButton("pins", "Pins", pins?.length ?? 0, fresh && tab !== "pins")}
          {tabButton("actions", "Actions", actionCount)}
        </div>
        {onNew && <IconButton icon="plus" label="New action" onClick={onNew} />}
      </div>
      {tab === "actions" ? (
        actions
      ) : (
        <div role="tabpanel" aria-label="Pins" className="flex flex-col gap-2.5">
          <ErrorText>{pinsError}</ErrorText>
          {pins === null ? !pinsError && <Loading /> : pins.length ? pins.map(cards) : <p className="rounded-2xl border border-dashed border-line-strong px-4 py-5 text-center text-[13px] text-ink-3">Nothing pinned yet.</p>}
          <p className="text-xs text-ink-3">Ask {agentName} to track something.</p>
        </div>
      )}
    </section>
  );
}
