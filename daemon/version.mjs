import { readFileSync } from "node:fs";
import { PI_PACKAGE } from "./config.mjs";

const piVersion = () => {
  try {
    return JSON.parse(readFileSync(`${PI_PACKAGE}/package.json`, "utf8")).version;
  } catch {
    return "unknown";
  }
};

export const BUILD = {
  version: process.env.WEILO_VERSION || "dev",
  commit: process.env.WEILO_COMMIT || "unknown",
  pi: piVersion(),
};
