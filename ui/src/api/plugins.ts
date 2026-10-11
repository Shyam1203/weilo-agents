import { request } from "./http";

/** An MCP server agents can use. */
export interface Plugin {
  name: string;
  /** The command it runs, or its web address. */
  detail: string;
}

export interface PluginStatus {
  state: string;
  error?: string;
  tools: number;
}

interface NewPlugin {
  name: string;
  /** Runs a command... */
  command?: string;
  env?: Record<string, string>;
  /** ...or reaches a web address. */
  url?: string;
  token?: string;
}

export const listPlugins = () => request<Plugin[]>("GET", "/api/plugins");
/** Whether each plugin connects, by name; takes a few seconds. */
export const pluginStatus = () => request<Record<string, PluginStatus>>("GET", "/api/plugins/status");
export const addPlugin = (plugin: NewPlugin) => request("POST", "/api/plugins", plugin);
export const removePlugin = (name: string) => request("DELETE", `/api/plugins/${name}`);
