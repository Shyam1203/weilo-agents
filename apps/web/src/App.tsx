import { useEffect } from "react";
import { DesktopShell } from "./features/shell/DesktopShell";
import { PhoneShell } from "./features/mobile/PhoneShell";
import { FirstRun } from "./features/first-run/FirstRun";
import { PairPage } from "./features/first-run/PairPage";
import { Toast } from "./features/shell/Toast";
import { navigate, useRoute } from "./lib/router";
import { useApp } from "./lib/store";
import { useDesktop } from "./lib/useMedia";

export function App() {
  const route = useRoute();
  const desktop = useDesktop();
  const conn = useApp((s) => s.conn);
  const ready = useApp((s) => s.snapshot !== null);
  const firstRun = useApp((s) => s.firstRunOpen);

  useEffect(() => {
    if (conn === "unpaired" && route.name !== "pair") navigate("/pair", { replace: true });
  }, [conn, route.name]);

  let screen;
  if (route.name === "pair") screen = <PairPage code={route.code} />;
  else if (!ready) screen = <Connecting reconnecting={conn === "reconnecting"} />;
  else if (firstRun) screen = <FirstRun />;
  else screen = desktop ? <DesktopShell route={route} /> : <PhoneShell route={route} />;

  return (
    <>
      {screen}
      <Toast />
    </>
  );
}

function Connecting({ reconnecting }: { reconnecting: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-4 text-body-sm text-text-secondary" role="status">
      {reconnecting ? "Can't reach your Weilo computer. Trying again…" : "Connecting to your Weilo computer…"}
    </div>
  );
}
