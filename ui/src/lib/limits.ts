// Limits the daemon checks too (daemon/config.mjs): change both together. The fields stop you
// early; the daemon has the last word.

/** A routine's name and task, in characters, and its times a day. */
export const MAX_ROUTINE_TITLE = 80;
export const MAX_ROUTINE_TASK = 4000;
export const MAX_TIMES = 6;
/** About you: your name and the text, in characters. */
export const MAX_NAME = 100;
export const MAX_ABOUT = 4000;
/** Settings > Browser: the rule, in characters. */
export const MAX_RULE = 1000;

/** Contact us: name, email and message, in characters. */
export const MAX_CONTACT_NAME = 100;
export const MAX_CONTACT_EMAIL = 254;
export const MAX_CONTACT_MESSAGE = 4000;

/** What one message can carry. The daemon's MAX_BODY must hold them all, as base64. */
export const MAX_IMAGES = 4;
export const MAX_FILES = 5;
export const MAX_FILE_MB = 5;
