import { request } from "./http";

export interface Provider {
  id: string;
  name: string;
  keyUrl?: string;
  connected: boolean;
}

export interface Model {
  id: string;
  name: string;
  /** Chosen in Settings for agents to use. */
  enabled: boolean;
}

/** A model id is "provider/model"; "" has no provider. */
export const providerOf = (modelId: string) => (modelId.includes("/") ? modelId.split("/")[0] : "");

export const modelsOf = (models: Model[], providerId: string) => models.filter((m) => providerOf(m.id) === providerId);

/** What agents can pick from a provider: the models enabled in Settings, or all of them when none is. */
export function choosableOf(models: Model[], providerId: string) {
  const all = modelsOf(models, providerId);
  const enabled = all.filter((m) => m.enabled);
  return enabled.length ? enabled : all;
}

export const listProviders = () => request<Provider[]>("GET", "/api/providers");
export const saveKey = (id: string, key: string) => request("PUT", `/api/providers/${id}`, { key });
export const removeKey = (id: string) => request("DELETE", `/api/providers/${id}`);
export const listModels = () => request<Model[]>("GET", "/api/models");
export const setEnabledModels = (ids: string[]) => request("PUT", "/api/models", { enabled: ids });
