import { request } from "./http";

/** A browser that gets notifications. */
export interface Device {
  id: string;
  label: string;
  /** When it was turned on, in ms. */
  added: number;
}

export interface PushStatus {
  /** The app's key, which a browser needs to subscribe. */
  publicKey: string;
  devices: Device[];
  /** The agents that send no notifications. */
  muted: string[];
}

export const getPush = () => request<PushStatus>("GET", "/api/push");
export const addDevice = (subscription: PushSubscriptionJSON, label: string) => request<{ id: string }>("POST", "/api/push/devices", { subscription, label });
export const removeDevice = (id: string) => request("DELETE", `/api/push/devices/${id}`);
export const setMuted = (muted: string[]) => request("PUT", "/api/push/muted", { muted });
