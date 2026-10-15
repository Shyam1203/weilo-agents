export const BUILD = {
  version: process.env.WEILO_VERSION || "dev",
  commit: process.env.WEILO_COMMIT || "unknown",
  pi: process.env.WEILO_PI || "unknown",
};
