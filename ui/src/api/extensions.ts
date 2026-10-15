import { base64Of } from "../lib/attachments";
import { request } from "./http";

export interface Extension {
  id: string;
  name: string;
  description: string;
  tools: string[];
  builtin: boolean;
}

export const listExtensions = () => request<Extension[]>("GET", "/api/extensions");
export const addExtension = async (file: File) => request("POST", "/api/extensions", { name: file.name, data: await base64Of(file) });
export const removeExtension = (id: string) => request("DELETE", `/api/extensions/${id}`);
