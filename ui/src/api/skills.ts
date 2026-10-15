import { base64Of } from "../lib/attachments";
import { request } from "./http";

export interface Skill {
  id: string;
  name: string;
  description: string;
}

export const listSkills = () => request<Skill[]>("GET", "/api/skills");
export const addSkills = async (file: File) => request("POST", "/api/skills", { name: file.name, data: await base64Of(file) });
export const removeSkill = (id: string) => request("DELETE", `/api/skills/${id}`);
