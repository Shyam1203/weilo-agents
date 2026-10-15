import { request } from "./http";

export interface Update {
  current: string;
  enabled: boolean;
  latest: string | null;
  url: string | null;
  available: boolean;
}

export const getUpdate = () => request<Update>("GET", "/api/update");
export const setUpdateCheck = (enabled: boolean) => request<Update>("PUT", "/api/update", { enabled });

export const TOPICS = ["Problem", "Idea", "Question", "Other"] as const;

export interface Contact {
  name: string;
  email: string;
  topic: (typeof TOPICS)[number];
  message: string;
}

export const sendContact = (contact: Contact) => request("POST", "/api/contact", contact);
