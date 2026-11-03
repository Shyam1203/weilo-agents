import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { App } from "./App";
import { connect, listener } from "./lib/app";
import { checkPaired, HostConnection, socketUrl } from "./lib/host";
import { fixtureRequested } from "./lib/mode";
import { applyTheme } from "./lib/theme";
import { installUndoGuards } from "./lib/undo";

applyTheme();
installUndoGuards();

async function boot(): Promise<void> {
  const onPairPage = window.location.pathname.startsWith("/pair");
  const fixture = fixtureRequested();
  if (fixture.on) {
    const { FixtureHost } = await import("./lib/fixture");
    connect(new FixtureHost(listener, { setupDone: fixture.setupDone, down: fixture.down, noEngines: fixture.noEngines }));
  } else if (!onPairPage) {
    connect(new HostConnection({ url: socketUrl(), listener, checkAuth: checkPaired }));
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
