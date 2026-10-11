// What this build is, set when the image is built (image/Dockerfile). A build without the arguments is "dev".
export const BUILD = {
  version: process.env.WEILO_VERSION || "dev",
  commit: process.env.WEILO_COMMIT || "unknown",
  pi: process.env.WEILO_PI || "unknown",
};
