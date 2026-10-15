import { request } from "./http";

export interface PairedDevice {
  id: string;
  name: string;
  added: string;
  seen: string;
  current: boolean;
}

export const listDevices = () => request<PairedDevice[]>("GET", "/api/devices");
export const newPairingCode = () => request<{ code: string; expires: string }>("POST", "/api/devices/code");
export const unpairDevice = (id: string) => request("DELETE", `/api/devices/${id}`);
export const pairThisDevice = (code: string) => request("POST", "/api/pair", { code });
