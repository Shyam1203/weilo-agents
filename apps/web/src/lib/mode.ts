/** Decides whether the app talks to a real host or runs on fixture data. Kept apart so the fixture is loaded only when asked for. */
/** Fixture mode is on for `?fixture=1` in dev (remembered for the tab), or when built with VITE_FIXTURE=1. */
export function fixtureRequested(): { on: boolean; setupDone: boolean; down: boolean; noEngines: boolean } {
  const params = new URLSearchParams(window.location.search);
  let on = import.meta.env.VITE_FIXTURE === "1";
  let setupDone = params.get("setup") !== "0";
  if (import.meta.env.DEV || on) {
    try {
      if (params.get("fixture") === "1") {
        sessionStorage.setItem("weilo.fixture", setupDone ? "1" : "setup");
      } else if (params.get("fixture") === "0") {
        sessionStorage.removeItem("weilo.fixture");
      }
      const saved = sessionStorage.getItem("weilo.fixture");
      if (saved) {
        on = true;
        setupDone = saved !== "setup";
      }
    } catch {
      on = on || params.get("fixture") === "1";
    }
  }
  // Not remembered: `down=1` shows the host saying it isn't ready; `engines=0` finds no AI app.
  return { on, setupDone, down: params.get("down") === "1", noEngines: params.get("engines") === "0" };
}
