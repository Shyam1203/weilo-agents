import { addDevice, removeDevice } from "../api/push";
import { KEYS, read, write } from "./storage";

export const registerWorker = () =>
  void navigator.serviceWorker
    ?.register("/sw.js")
    .then(relink)
    .catch(() => {});

// Notifications turned on before devices were paired belong to no device yet: tie them to this one.
async function relink(worker: ServiceWorkerRegistration) {
  if (!thisDevice() || unsupported() || Notification.permission !== "granted") return;
  const subscription = await worker.pushManager.getSubscription();
  if (subscription) write(KEYS.device, (await addDevice(subscription.toJSON(), deviceLabel())).id);
}

const iOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export function unsupported(): string | null {
  if (!window.isSecureContext) return "Notifications need a secure address: open the app at localhost on this computer, or at its Tailscale https address.";
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return null;
  if (iOS())
    return "On iPhone and iPad, notifications work in the app opened from your Home Screen (Share, then Add to Home Screen, with Open as Web App on). If you opened it from there, update iOS to 16.4 or later.";
  return "This browser cannot show notifications.";
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || iOS() ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return browser && device !== "iPhone" && device !== "iPad" ? `${device} · ${browser}` : device;
}

export const thisDevice = () => read(KEYS.device);

export async function turnOn(publicKey: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked for this site. Allow them in the browser's site settings, then try again.");
  const worker = await navigator.serviceWorker.ready;
  const subscription = (await worker.pushManager.getSubscription()) ?? (await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey }));
  const { id } = await addDevice(subscription.toJSON(), deviceLabel());
  write(KEYS.device, id);
}

export async function turnOff() {
  const id = thisDevice();
  write(KEYS.device, null);
  const worker = await navigator.serviceWorker?.getRegistration();
  await (await worker?.pushManager.getSubscription())?.unsubscribe().catch(() => {});
  if (id) await removeDevice(id);
}
