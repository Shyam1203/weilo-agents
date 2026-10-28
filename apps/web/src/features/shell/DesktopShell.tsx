import type { Route } from "../../lib/router";
import { Rail } from "./Rail";
import { RoutePage } from "./Pages";
import { Sidebar } from "./Sidebar";

/** Rail (80) · Sidebar (272) · the page, with its side panel when open. */
export function DesktopShell({ route }: { route: Route }) {
  return (
    <div className="flex h-full min-h-0 bg-bg">
      <Rail route={route} />
      <Sidebar route={route} />
      <div className="flex min-h-0 min-w-0 flex-1">
        <RoutePage route={route} />
      </div>
    </div>
  );
}
