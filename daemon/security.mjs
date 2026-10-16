import { isIsolated, mayCall, profiles } from "./agents/agents.mjs";
import { recentAudit } from "./audit.mjs";
import { pairedDevices } from "./http/access.mjs";
import { sandboxStatus } from "./sandbox/client.mjs";
import { STALE_DEVICE_DAYS } from "./config.mjs";
import { updateStatus } from "./update.mjs";

const names = (agents) => agents.map((a) => a.name).join(", ");

export async function securityReport() {
  const [sandbox, agents, devices, update, activity] = await Promise.all([sandboxStatus(), profiles(), pairedDevices(), updateStatus().catch(() => null), recentAudit(50)]);
  const isolated = agents.filter(isIsolated);
  const browsing = isolated.filter((a) => mayCall(a, "browser"));
  const stale = devices.filter((d) => Date.now() - Date.parse(d.seen) > STALE_DEVICE_DAYS * 864e5);
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
      ok: !browsing.length,
      title: "Browser",
      detail: browsing.length ? `${names(browsing)} can use the browser, with the sign-ins of every site you are signed in to there.` : "No isolated agent can use the browser.",
    },
    {
      ok: !stale.length,
      title: "Paired devices",
      detail: stale.length ? `Not used for ${STALE_DEVICE_DAYS} days: ${stale.map((d) => d.name).join(", ")}. Unpair them in Devices.` : `${devices.length} paired, each used in the last ${STALE_DEVICE_DAYS} days.`,
    },
    {
      ok: !update?.available,
      title: "Version",
      detail: update?.available ? `Version ${update.latest} is out (you have ${update.current}). Run the update script.` : "Up to date, or the check for updates is off.",
    },
  ];
  return { checks, activity };
}
