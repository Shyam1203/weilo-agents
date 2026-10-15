import { request } from "./http";

export interface User {
  name: string;
  about: string;
}

export const getUser = () => request<User>("GET", "/api/user");
export const saveUser = (user: User) => request<User>("PUT", "/api/user", user);
