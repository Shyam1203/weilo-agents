import type { ReactNode } from "react";
import { IconButton } from "./Button";

/** The bar across the top of the chat: a back button on phones (to the agent list), the title (a button), and actions. */
export function TopBar({ leading, title, subtitle, actions, onBack, onTitle }: { leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; onBack?: () => void; onTitle: () => void }) {
  const heading = (
    <>
      {leading}
      <span className="block min-w-0 flex-1 text-left">
        <span className="block truncate text-[15px] font-semibold tracking-tight">{title}</span>
        {subtitle && <span className="flex items-center gap-1.5 truncate text-xs text-ink-3">{subtitle}</span>}
      </span>
    </>
  );
  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-3 sm:px-4">
      {onBack && <IconButton icon="chevronLeft" label="Back" onClick={onBack} className="-ml-1 md:hidden" />}
      <button type="button" onClick={onTitle} className="-mx-2 flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-1 transition-colors hover:bg-select">
        {heading}
      </button>
      <span className="flex-1" />
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}
