// This browser's side of notifications: the service worker (public/sw.js), and subscribing at the browser's push service.
import { addDevice, removeDevice } from "../api/push";
import { KEYS, read, write } from "./storage";

/** Registers the service worker, which shows notifications and opens a chat from one. */
export const registerWorker = () => void navigator.serviceWorker?.register("/sw.js").catch(() => {});

const iOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches;

/** Why this browser cannot get notifications, or null when it can. */
export function unsupported(): string | null {
  if (!window.isSecureContext) return "Notifications need a secure address: open the app at localhost on this computer, or at its Tailscale https address.";
  if (iOS() && !standalone()) return "On iPhone and iPad, add Weilo Agents to your Home Screen first (Share, then Add to Home Screen), and open it from there.";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "This browser cannot show notifications.";
  return null;
}

/** A name for this device in the list: "iPhone", "Windows · Chrome". */
function deviceLabel() {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || iOS() ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return browser && device !== "iPhone" && device !== "iPad" ? `${device} · ${browser}` : device;
}

/** This browser's device id, if it turned notifications on. */
export const thisDevice = () => read(KEYS.device);

/** Asks to show notifications and subscribes this browser. Throws with a sentence to show when it cannot. */
export async function turnOn(publicKey: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked for this site. Allow them in the browser's site settings, then try again.");
  const worker = await navigator.serviceWorker.ready;
  const subscription = (await worker.pushManager.getSubscription()) ?? (await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey }));
  const { id } = await addDevice(subscription.toJSON(), deviceLabel());
  write(KEYS.device, id);
}

/** Stops notifications to this browser. */
export async function turnOff() {
  const id = thisDevice();
  write(KEYS.device, null);
  const worker = await navigator.serviceWorker?.getRegistration();
  await (await worker?.pushManager.getSubscription())?.unsubscribe().catch(() => {});
  if (id) await removeDevice(id);
}
