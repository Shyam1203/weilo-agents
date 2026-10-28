import type { Route } from "../../lib/router";
import { RoutePage } from "../shell/Pages";
import { VariantContext } from "../thread/useThread";
import { TabBar } from "./TabBar";

const TOP_LEVEL = new Set<Route["name"]>(["home", "channels", "agents", "settings", "needs", "routines", "connections"]);

/** Phones: one column, the page, and the tab bar on top-level pages. */
export function PhoneShell({ route }: { route: Route }) {
  return (
    <VariantContext.Provider value="phone">
      <div className="safe-top flex h-full min-h-0 flex-col bg-bg">
        <div className="flex min-h-0 flex-1">
          <RoutePage route={route} phone />
        </div>
        {TOP_LEVEL.has(route.name) && <TabBar route={route} />}
      </div>
    </VariantContext.Provider>
  );
}
