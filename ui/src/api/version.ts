import { request } from "./http";

/** What this build is; "dev" and "unknown" for a build from a checkout. */
export interface Build {
  version: string;
  commit: string;
  pi: string;
}

export const getVersion = () => request<Build>("GET", "/api/version");
