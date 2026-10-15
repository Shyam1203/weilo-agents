import { isIsolated, profiles } from "./agents/agents.mjs";
import { recentAudit } from "./audit.mjs";
import { usesSignIn } from "./gateway/models.mjs";
import { pairedDevices } from "./http/access.mjs";
import { sandboxStatus } from "./sandbox/client.mjs";
import { updateStatus } from "./update.mjs";

const STALE_MS = 90 * 24 * 60 * 60_000;
const names = (agents) => agents.map((a) => a.name).join(", ");

export async function securityReport() {
  const [sandbox, agents, devices, update, activity] = await Promise.all([sandboxStatus(), profiles(), pairedDevices(), updateStatus().catch(() => null), recentAudit(50)]);
  const isolated = agents.filter(isIsolated);
  const signedIn = (await Promise.all(isolated.map(async (a) => ((await usesSignIn(a.model).catch(() => false)) ? [a] : [])))).flat();
  const browsing = isolated.filter((a) => !a.disabled.includes("browser"));
  const stale = devices.filter((d) => Date.now() - Date.parse(d.seen) > STALE_MS);
  const checks = [
    {
      ok: sandbox.running && sandbox.namespaces,
      title: "Sandbox for isolated agents",
      detail: !sandbox.running
        ? "Not running, so isolated agents cannot start. Run the start script again."
        : sandbox.namespaces
          ? "Running. Each isolated agent, and each plugin it uses, has its own processes, /tmp and folder, and no key."
          : "Running, but it cannot make namespaces, so it starts nothing. See: docker compose logs sandbox",
    },
    {
      ok: !signedIn.length,
      title: "Account sign-ins",
      detail: signedIn.length
        ? `${names(signedIn)} use a provider you signed in to with an account. pi must hold that account's access token to make its requests, so these isolated agents could read it. Give them a provider with an API key, which never leaves the app.`
        : "No isolated agent holds an account's access token.",
    },
    {
      ok: !browsing.length,
      title: "Browser",
      detail: browsing.length ? `${names(browsing)} can use the browser, with the sign-ins of every site you are signed in to there.` : "No isolated agent can use the browser.",
    },
    {
      ok: !stale.length,
      title: "Paired devices",
      detail: stale.length ? `Not used for 90 days: ${stale.map((d) => d.name).join(", ")}. Unpair them in Devices.` : `${devices.length} paired, each used in the last 90 days.`,
    },
    {
      ok: !update?.available,
      title: "Version",
      detail: update?.available ? `Version ${update.latest} is out (you have ${update.current}). Run the update script.` : "Up to date, or the check for updates is off.",
    },
  ];
  return { checks, activity };
}
