import type { ReactNode } from "react";
import { cx } from "../../lib/format";
import { paths, type Route } from "../../lib/router";
import { ConnectionsIcon, HomeIcon, RoutinesIcon, SettingsIcon, SidebarIcon } from "../../ui/glyphs";
import { Link } from "../../ui/Link";

function RailLink({ href, label, icon, current }: { href: string; label: string; icon: ReactNode; current: boolean }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cx(
        railItem,
        current ? "bg-surface text-text shadow-e1" : "text-text-secondary hover:bg-border",
      )}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

const railItem = "flex w-[72px] flex-col items-center gap-1 rounded-md py-2 text-caption font-medium hover:no-underline";

/** Home · Routines · Connections, and Settings at the bottom. 80 wide. On narrow windows it also opens the sidebar. */
export function Rail({ route, sidebar }: { route: Route; sidebar?: { open: boolean; toggle(): void } | null }) {
  const home = ["home", "agent", "channel", "session", "channels", "agents"].includes(route.name);
  return (
    <nav aria-label="Pages" className="flex w-20 shrink-0 flex-col items-center border-r border-border bg-surface-muted">
      <div className="flex h-14 shrink-0 items-center justify-center">
        <Link
          href={paths.home()}
          aria-label="Weilo home"
          className="flex size-8 items-center justify-center rounded-md bg-accent text-body font-semibold text-on-accent hover:no-underline"
        >
          W
        </Link>
      </div>
      <div className="flex flex-col items-center gap-1 pt-2">
        {sidebar && (
          <button
            type="button"
            aria-expanded={sidebar.open}
            aria-controls="sidebar"
            onClick={sidebar.toggle}
            className={cx(railItem, "border-0", sidebar.open ? "bg-surface text-text shadow-e1" : "bg-transparent text-text-secondary hover:bg-border")}
          >
            <SidebarIcon size={20} />
            <span>Sidebar</span>
          </button>
        )}
        <RailLink href={paths.home()} label="Home" icon={<HomeIcon size={20} />} current={home} />
        <RailLink href={paths.routines()} label="Routines" icon={<RoutinesIcon size={20} />} current={route.name === "routines"} />
        <RailLink
          href={paths.connections()}
          label="Connections"
          icon={<ConnectionsIcon size={20} />}
          current={route.name === "connections"}
        />
      </div>
      <div className="flex-1" />
      <div className="mb-3">
        <RailLink href={paths.settings()} label="Settings" icon={<SettingsIcon size={20} />} current={route.name === "settings"} />
      </div>
    </nav>
  );
}
