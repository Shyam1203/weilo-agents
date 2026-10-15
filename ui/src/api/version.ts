import { request } from "./http";

export interface Build {
  version: string;
  commit: string;
  pi: string;
}

export const getVersion = () => request<Build>("GET", "/api/version");
