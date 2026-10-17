import { request } from "./http";

export interface PushStatus {
  publicKey: string;
  devices: string[];
  muted: string[];
}

export const getPush = () => request<PushStatus>("GET", "/api/push");
export const addDevice = (subscription: PushSubscriptionJSON) => request<{ id: string }>("POST", "/api/push/devices", { subscription });
export const removeDevice = (id: string) => request("DELETE", `/api/push/devices/${id}`);
export const setMuted = (muted: string[]) => request("PUT", "/api/push/muted", { muted });
