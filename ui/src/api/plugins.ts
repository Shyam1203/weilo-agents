import { request } from "./http";

export interface Plugin {
  name: string;
  detail: string;
}

export interface PluginStatus {
  state: string;
  error?: string;
  tools: number;
}

interface NewPlugin {
  name: string;
  command?: string;
  env?: Record<string, string>;
  url?: string;
  token?: string;
}

export const listPlugins = () => request<Plugin[]>("GET", "/api/plugins");
export const pluginStatus = () => request<Record<string, PluginStatus>>("GET", "/api/plugins/status");
export const addPlugin = (plugin: NewPlugin) => request("POST", "/api/plugins", plugin);
export const removePlugin = (name: string) => request("DELETE", `/api/plugins/${name}`);
