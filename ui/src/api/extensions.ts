import { base64Of } from "../lib/attachments";
import { request } from "./http";

export interface Extension {
  id: string;
  name: string;
  description: string;
  /** The tools it adds. */
  tools: string[];
  /** It comes with the app: an agent has it unless you turn it off, and it cannot be deleted. */
  builtin: boolean;
}

export const listExtensions = () => request<Extension[]>("GET", "/api/extensions");
/** Adds the extension in a .zip file. */
export const addExtension = async (file: File) => request("POST", "/api/extensions", { name: file.name, data: await base64Of(file) });
export const removeExtension = (id: string) => request("DELETE", `/api/extensions/${id}`);
