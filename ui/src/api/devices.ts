import { request } from "./http";

/** A browser paired with the app: only these can use it. */
export interface PairedDevice {
  id: string;
  /** "Chrome on Windows". */
  name: string;
  added: string;
  /** When it was last used (written down at most once an hour). */
  seen: string;
  /** The browser this list is shown in. */
  current: boolean;
}

export const listDevices = () => request<PairedDevice[]>("GET", "/api/devices");
/** A code that pairs another browser, for 10 minutes. */
export const newPairingCode = () => request<{ code: string; expires: string }>("POST", "/api/devices/code");
export const unpairDevice = (id: string) => request("DELETE", `/api/devices/${id}`);
/** Pairs this browser: the app sets its key as a cookie. */
export const pairThisDevice = (code: string) => request("POST", "/api/pair", { code });
