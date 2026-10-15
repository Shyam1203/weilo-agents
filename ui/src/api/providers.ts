import { request } from "./http";

export interface Provider {
  id: string;
  name: string;
  keyUrl?: string;
  signIn?: string;
  connected: boolean;
  account: boolean;
}

export interface SignIn {
  state: "working" | "waiting" | "done" | "failed";
  message?: string;
  url?: string;
  code?: string;
  ask?: { type: "text" | "secret" | "select" | "paste"; message: string; placeholder?: string; options?: { id: string; label: string }[] };
}

export interface Model {
  id: string;
  name: string;
  enabled: boolean;
}

export const providerOf = (modelId: string) => (modelId.includes("/") ? modelId.split("/")[0] : "");

export const modelsOf = (models: Model[], providerId: string) => models.filter((m) => providerOf(m.id) === providerId);

export function choosableOf(models: Model[], providerId: string) {
  const all = modelsOf(models, providerId);
  const enabled = all.filter((m) => m.enabled);
  return enabled.length ? enabled : all;
}

export const listProviders = () => request<Provider[]>("GET", "/api/providers");
export const saveKey = (id: string, key: string) => request("PUT", `/api/providers/${id}`, { key });
export const removeKey = (id: string) => request("DELETE", `/api/providers/${id}`);
export const startSignIn = (id: string) => request<SignIn>("POST", `/api/providers/${id}/sign-in`);
export const signInStatus = (id: string) => request<SignIn>("GET", `/api/providers/${id}/sign-in`);
export const answerSignIn = (id: string, answer: string) => request<SignIn>("PUT", `/api/providers/${id}/sign-in`, { answer });
export const stopSignIn = (id: string) => request("DELETE", `/api/providers/${id}/sign-in`);
export const listModels = () => request<Model[]>("GET", "/api/models");
export const setEnabledModels = (ids: string[]) => request("PUT", "/api/models", { enabled: ids });

export const shortName = (name: string) => name.replace(/^([^:]+):\s+(?=\1\b)/i, "");
