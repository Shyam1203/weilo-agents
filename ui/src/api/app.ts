import { request } from "./http";

/** Whether a newer release exists (the newest on GitHub, checked now and then; never for a build from a checkout). */
export interface Update {
  current: string;
  /** The check is on (Settings > About). */
  enabled: boolean;
  latest: string | null;
  /** The release's page. */
  url: string | null;
  available: boolean;
}

export const getUpdate = () => request<Update>("GET", "/api/update");
export const setUpdateCheck = (enabled: boolean) => request<Update>("PUT", "/api/update", { enabled });

// Must match TOPICS in daemon/contact.mjs.
export const TOPICS = ["Problem", "Idea", "Question", "Other"] as const;

/** A message to Weilo. */
export interface Contact {
  name: string;
  email: string;
  topic: (typeof TOPICS)[number];
  message: string;
}

export const sendContact = (contact: Contact) => request("POST", "/api/contact", contact);
