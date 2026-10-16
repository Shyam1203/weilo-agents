import type { ReactNode } from "react";
import { IconButton } from "./Button";

// The avatar and the title open onTitle; the subtitle sits outside that button, so it can hold its own controls.
export function TopBar({ leading, title, subtitle, actions, onBack, onTitle }: { leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; onBack?: () => void; onTitle: () => void }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-3 sm:px-4">
      {onBack && <IconButton icon="chevronLeft" label="Back" onClick={onBack} className="-ml-1 md:hidden" />}
      <div className="flex min-w-0 items-center gap-2.5">
        {leading && (
          <button type="button" onClick={onTitle} tabIndex={-1} aria-hidden="true" className="shrink-0 rounded-full">
            {leading}
          </button>
        )}
        <span className="flex min-w-0 flex-col items-start">
          <button type="button" onClick={onTitle} className="-mx-1.5 max-w-full truncate rounded-md px-1.5 text-left text-[15px] font-semibold tracking-tight transition-colors hover:bg-select">
            {title}
          </button>
          {subtitle && <span className="flex max-w-full min-w-0 items-center gap-1.5 text-xs text-ink-3">{subtitle}</span>}
        </span>
      </div>
      <span className="flex-1" />
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}
