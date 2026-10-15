import { request } from "./http";

export interface Device {
  id: string;
  label: string;
  added: number;
}

export interface PushStatus {
  publicKey: string;
  devices: Device[];
  muted: string[];
}

export const getPush = () => request<PushStatus>("GET", "/api/push");
export const addDevice = (subscription: PushSubscriptionJSON, label: string) => request<{ id: string }>("POST", "/api/push/devices", { subscription, label });
export const removeDevice = (id: string) => request("DELETE", `/api/push/devices/${id}`);
export const setMuted = (muted: string[]) => request("PUT", "/api/push/muted", { muted });
