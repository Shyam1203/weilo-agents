import { request } from "./http";

export interface Provider {
  id: string;
  name: string;
  keyUrl?: string;
  /** The account it can be signed in with instead of a key ("Claude Pro or Max"). */
  signIn?: string;
  connected: boolean;
  /** Signed in with an account, not a key. */
  account: boolean;
}

/** Where a sign-in is: what to open, a code to type there, or a question to answer. */
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
export const startSignIn = (id: string) => request<SignIn>("POST", `/api/providers/${id}/sign-in`);
export const signInStatus = (id: string) => request<SignIn>("GET", `/api/providers/${id}/sign-in`);
export const answerSignIn = (id: string, answer: string) => request<SignIn>("PUT", `/api/providers/${id}/sign-in`, { answer });
export const stopSignIn = (id: string) => request("DELETE", `/api/providers/${id}/sign-in`);
export const listModels = () => request<Model[]>("GET", "/api/models");
export const setEnabledModels = (ids: string[]) => request("PUT", "/api/models", { enabled: ids });
