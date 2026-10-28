import type { ReactNode } from "react";
import { cx } from "../../lib/format";
import { paths, type Route } from "../../lib/router";
import { ConnectionsIcon, HomeIcon, RoutinesIcon, SettingsIcon } from "../../ui/glyphs";
import { Link } from "../../ui/Link";

function RailLink({ href, label, icon, current }: { href: string; label: string; icon: ReactNode; current: boolean }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cx(
        "flex w-[72px] flex-col items-center gap-1 rounded-md py-2 text-caption font-medium hover:no-underline",
        current ? "bg-surface text-text shadow-e1" : "text-text-secondary hover:bg-border",
      )}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

/** Home · Routines · Connections, and Settings at the bottom. 80 wide. */
export function Rail({ route }: { route: Route }) {
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
