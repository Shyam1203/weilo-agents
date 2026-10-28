import type { ReactNode } from "react";
import { cx } from "../../lib/format";
import { navigate, paths, type Route } from "../../lib/router";
import { pendingNeedsYou, useApp } from "../../lib/store";
import { AgentsIcon, BackIcon, ChatIcon, YouIcon } from "../../ui/glyphs";
import { IconButton } from "../../ui/IconButton";
import { Link } from "../../ui/Link";

function Tab({ href, label, icon, current, badge }: { href: string; label: string; icon: ReactNode; current: boolean; badge?: number }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      aria-label={badge ? `${label}, ${badge} need you` : undefined}
      className={cx(
        "relative flex h-14 w-16 flex-col items-center justify-center gap-0.5 text-caption font-medium hover:no-underline",
        current ? "text-accent-text" : "text-text-secondary",
      )}
    >
      {icon}
      {label}
      {badge ? (
        <span aria-hidden="true" className="absolute top-1 right-3 flex h-4 min-w-4 items-center justify-center rounded-full bg-badge px-1 text-caption font-semibold text-on-badge">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/** Chat · Channels · Agents · You. 56 tall plus the safe area. */
export function TabBar({ route }: { route: Route }) {
  const needs = useApp((s) => pendingNeedsYou(s).length);
  const chat = route.name === "home" || route.name === "needs";
  return (
    <nav aria-label="Tabs" className="safe-bottom shrink-0 border-t border-border bg-surface">
      <div className="flex h-14 items-stretch justify-around px-2">
        <Tab href={paths.home()} label="Chat" icon={<ChatIcon size={24} />} current={chat} badge={chat ? 0 : needs} />
        <Tab
          href={paths.channels()}
          label="Channels"
          icon={
            <span aria-hidden="true" className="h-6 text-title font-medium leading-6">
              #
            </span>
          }
          current={route.name === "channels"}
        />
        <Tab href={paths.agents()} label="Agents" icon={<AgentsIcon size={24} />} current={route.name === "agents"} />
        <Tab href={paths.settings()} label="You" icon={<YouIcon size={24} />} current={route.name === "settings"} />
      </div>
    </nav>
  );
}

export function BackButton() {
  return (
    <IconButton
      label="Back"
      size={44}
      className="-ml-3"
      onClick={() => (window.history.length > 1 ? window.history.back() : navigate(paths.home()))}
    >
      <BackIcon size={24} />
    </IconButton>
  );
}
