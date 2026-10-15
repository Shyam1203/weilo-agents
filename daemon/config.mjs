// The values a maintainer may want to change, in one place. Plain constants: nothing reads a
// config file or the environment. A tool description (weilo.mjs) that names a limit is built from it; the UI
// repeats some limits in ui/src/lib/limits.ts (marked "UI" here): change both together.

const MINUTE = 60_000;

// --- Server ----------------------------------------------------------------------------------

// The daemon's port in the container (compose.yaml publishes it on 127.0.0.1).
export const PORT = 3210;
// Largest request body, in characters: a message with the UI's most images and files, which travel as base64.
export const MAX_BODY = 64e6;

// --- Devices (http/access.mjs) ----------------------------------------------------------------

// A pairing code works this long (ms). After this many wrong codes in that time, pairing waits until it has passed.
export const PAIR_CODE_MS = 10 * MINUTE;
export const PAIR_WRONG_CODES = 10;
// How long a paired device stays paired without being used (s; a browser keeps a cookie at most 400 days), and how
// often its last use is written down (ms).
export const DEVICE_COOKIE_S = 400 * 24 * 60 * 60;
export const DEVICE_SEEN_MS = 60 * MINUTE;
// Where a pairing code is asked for from inside the container (pair.mjs): a socket in a folder only the daemon's user can open.
export const ADMIN_SOCKET = "/tmp/weilo-admin/admin.sock";

// --- The app (contact.mjs, update.mjs) --------------------------------------------------------

// Where "Contact us" sends a message (weilo-api, which passes it on to Weilo), and the longest wait for it (ms).
export const CONTACT_URL = "https://api.weilo.xyz/public/contact";
export const CONTACT_TIMEOUT_MS = 15_000;
// Where the newest release is looked up, how long an answer is kept (ms), and the longest wait for it (ms).
export const RELEASES_URL = "https://api.github.com/repos/Shyam1203/weilo-agents/releases/latest";
export const UPDATE_CACHE_MS = 6 * 60 * MINUTE;
export const UPDATE_TIMEOUT_MS = 10_000;
// "Contact us" limits (the API's own: 100, 254 and 5000 characters), in characters (UI).
export const MAX_CONTACT_NAME = 100;
export const MAX_CONTACT_EMAIL = 254;
export const MAX_CONTACT_MESSAGE = 4000;

// --- Notifications (push.mjs) -----------------------------------------------------------------

// Who the app is, to the push services (they ask for a contact: a mailto: or https: address).
export const PUSH_SUBJECT = "https://github.com/Shyam1203/weilo-agents";
// No notification while the app was on screen this recently (ms): its agent list asks every 2 to 5 seconds while it is.
export const PUSH_SEEN_MS = 15_000;
// How long a push service keeps a notification for a device that is off (s), the longest wait for one (ms), and the most
// characters of the agent's words a notification shows.
export const PUSH_TTL_S = 24 * 60 * 60;
export const PUSH_TIMEOUT_MS = 10_000;
export const PUSH_BODY_CHARS = 180;

// --- Users (users.mjs) ------------------------------------------------------------------------

// The Linux users the daemon (root) runs things as. The browser runs as the image's own user; each agent as a user of its
// own, numbered from FIRST_AGENT_UID, in one group that shares the workspace.
export const BROWSER_UID = 1000;
export const CURATOR_UID = 1100;
export const PLUGINS_UID = 1200;
export const AGENTS_GID = 2000;
export const FIRST_AGENT_UID = 2001;
// The PATH of everything the daemon starts, and the programs it starts itself, by their full path: folders only root can
// change. The image's PATH starts with the tools agents install (~/.local/bin, which their group can change), so a program
// found there by name could be an agent's, run as root. (A test checks no program is started by its bare name.)
export const SYSTEM_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
export const BIN = {
  setpriv: "/usr/bin/setpriv",
  chown: "/bin/chown",
  chmod: "/bin/chmod",
  find: "/usr/bin/find",
  unzip: "/usr/bin/unzip",
  zipinfo: "/usr/bin/zipinfo",
  pi: "/usr/local/bin/pi",
  Xvnc: "/usr/bin/Xvnc",
  openbox: "/usr/bin/openbox",
  chromium: "/usr/bin/chromium",
};

// --- Agents (agents/) ------------------------------------------------------------------------

// Pi's built-in tools every agent has: read and change files, and run programs.
export const PI_TOOLS = ["read", "bash", "edit", "write"];
// The tools of ours that reach what all agents share (the skill library, memory, the vault): an isolated agent has none of them.
export const SHARED_TOOLS = ["skill", "memory", "fetch_knowledge"];
// The tools every agent has: the chat's own (weilo.mjs) and memory's (memory/extension.mjs); an isolated one, the first three.
export const CORE_TOOLS = ["show", "ask", "manage_agents", ...SHARED_TOOLS];
// Pi's built-in extensions (pi 1.2.0, `builtin:<name>`). An agent's pi loads these, ours (weilo.mjs, memory/extension.mjs), the extensions that
// come with the app (extension/ in browser/ and routines/) unless the agent turned them off, and the ones it turned on (settings/extensions.mjs),
// and nothing else it finds in `agent/extensions/` or `settings.json`.
// Add a new built-in here when pi gets one, or agents lose it.
export const PI_BUILTINS = ["mcp", "codemode", "tool-search", "llama.cpp"];
// Tool names an extension may not declare: pi's own, the chat's and codemode. (A tool of an extension that comes with the
// app may be declared by another one: the agent turns the first off.)
export const RESERVED_TOOLS = [...new Set([...PI_TOOLS, ...CORE_TOOLS, "codemode"])];
// A pi with no viewer and no run stops after this long (ms).
export const IDLE_MS = 10 * MINUTE;
// Pi is asked to stop (stdin closed); it is killed if it has not after this long (ms).
export const PI_KILL_MS = 5000;
// The agent list reads this much of the end of a chat file (bytes), and shows this many characters of its newest message.
export const PREVIEW_TAIL = 64 * 1024;
export const PREVIEW_CHARS = 140;
// A chat shows what pi holds; what it summarized away is read from the chat file, this many messages at a time.
export const EARLIER_PAGE = 60;
// Searching the chats (agents/search.mjs): the longest search, in characters (UI), and the most results.
export const MAX_SEARCH = 200;
export const SEARCH_RESULTS = 50;

// --- Providers and models (settings/) --------------------------------------------------------

// Offered in Settings (ids are pi's). Providers already in auth.json are listed too. `signIn` names the account a
// provider can be signed in with instead of a key (pi's own login, settings/login.mjs); `keyUrl` is where a key is made.
export const PROVIDERS = [
  { id: "anthropic", name: "Anthropic", keyUrl: "https://console.anthropic.com/settings/keys", signIn: "Claude Pro or Max" },
  { id: "openai", name: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", signIn: "ChatGPT Plus or Pro" },
  { id: "github-copilot", name: "GitHub Copilot", signIn: "GitHub Copilot" },
  { id: "openrouter", name: "OpenRouter", keyUrl: "https://openrouter.ai/keys", signIn: "OpenRouter" },
  { id: "google", name: "Google Gemini", keyUrl: "https://aistudio.google.com/apikey" },
];
// pi's own code, for signing in (the image installs it there), and how this app introduces itself to a provider.
export const PI_SDK = "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
export const SIGN_IN_AS = "Weilo Agents";
// A sign-in not finished in this long (ms) is given up.
export const SIGN_IN_TIMEOUT_MS = 15 * MINUTE;
// How long (ms) a sign-in request waits for the next step before answering with where it is.
export const SIGN_IN_STEP_MS = 8000;
// Longest wait for pi to list the models the keys can use (ms).
export const MODELS_TIMEOUT_MS = 90_000;
// Long conversations are summarized when this share of the context window is used: 40% of a 1M window, 80% of a 500k
// one, 90% of any smaller (the chat's meter shows it).
export const COMPACT_AT = (window) => (window >= 1e6 ? 0.4 : window >= 5e5 ? 0.8 : 0.9);
// Tokens always kept free for a reply (pi's own default).
export const MIN_RESERVE = 16384;
// Longest wait for `pi mcp list`, which starts every plugin (ms).
export const PLUGIN_STATUS_TIMEOUT_MS = 90_000;
// Largest skill .zip once unzipped (bytes); the refusal says "50 MB".
export const MAX_UNZIPPED = 50e6;
// How deep in an uploaded .zip a SKILL.md is looked for (folders).
export const SKILL_DEPTH = 3;
// About you (USER.md): longest name and text, in characters (UI).
export const MAX_NAME = 100;
// A skill an agent saves: its description (what pi shows the model to choose by) and its instructions (characters).
export const MAX_SKILL_DESCRIPTION = 1024;
export const MAX_SKILL_TEXT = 60_000;
export const MAX_ABOUT = 4000;

// --- Memory (memory/) ------------------------------------------------------------------------
// The memory tool description tells the model the notes' limits.

// MEMORY.md: at most this many notes, characters in the file, and characters in one note.
export const MAX_NOTES = 40;
export const MAX_NOTES_CHARS = 3000;
export const MAX_NOTE = 200;
// A note this similar to another (shared words over all words, 0 to 1) is a duplicate.
export const SIMILAR = 0.7;

// fetch_knowledge: at most this many results, characters per excerpt, and characters in all.
export const FETCH_TOP = 5;
export const FETCH_EXCERPT = 480;
export const FETCH_MAX_CHARS = 1800;
// Only this much of the end of each chat file is searched (bytes): browser pages make chats large.
export const CHAT_TAIL = 32e6;

// The curator looks at the chats this often (ms) ...
export const CURATOR_EVERY_MS = 5 * MINUTE;
// ... reads one that has been quiet this long (ms), or, if it never is, this long after its last run (ms).
export const CURATOR_QUIET_MS = 10 * MINUTE;
export const CURATOR_MAX_GAP_MS = 12 * 60 * MINUTE;
// One curator run (a model with file tools) may take this long (ms).
export const CURATOR_TIMEOUT_MS = 10 * MINUTE;
// The chat goes to the model in pieces of at most this many characters, at most this many pieces a run,
// and at most this many characters of each message.
export const CURATOR_MAX_INPUT = 24000;
export const CURATOR_MAX_PIECES = 6;
export const CURATOR_MAX_MESSAGE = 1500;
// A chat whose runs fail this many times in a row waits for a new message.
export const CURATOR_MAX_FAILURES = 3;

// --- Routines (routines/) --------------------------------------------------------------------

// How often due routines are looked for (ms).
export const ROUTINES_EVERY_MS = 30_000;
// At most this many routines per agent, and times per routine (UI).
export const MAX_ROUTINES = 50;
export const MAX_TIMES = 6;
// Longest title and task, in characters (UI).
export const MAX_ROUTINE_TITLE = 80;
export const MAX_ROUTINE_TASK = 4000;
// A one-time routine may be at most this many minutes ahead (a year).
export const MAX_IN_MINUTES = 525_600;
// A routine missed by more than this (the computer was off) waits for its next time (ms).
export const LATE_MS = 60 * MINUTE;
// How long a routine waits for its agent to take the task (ms).
export const SEND_MS = MINUTE;

// --- Browser (browser/) ----------------------------------------------------------------------

// The virtual screen, in pixels.
export const SCREEN = { width: 1280, height: 800 };
// A program of the screen that stops starts again after this long (ms).
export const SCREEN_RESTART_MS = 2000;
// Largest message from the live view (bytes); a bigger one closes it.
export const MAX_VIEW_MESSAGE = 1 << 20;
// The page as text: at most this many characters, read after the page has settled this long (ms).
export const SNAPSHOT_MAX = 15_000;
export const SETTLE_MS = 600;
// Waits (ms): to connect to Chromium, to load a page (open, new_tab), to go back, for an element (click, type),
// for a page's first content, for the snapshot, and for a new tab.
export const CONNECT_TIMEOUT_MS = 15_000;
export const LOAD_TIMEOUT_MS = 30_000;
export const BACK_TIMEOUT_MS = 15_000;
export const ELEMENT_TIMEOUT_MS = 8000;
export const CONTENT_TIMEOUT_MS = 5000;
export const SNAPSHOT_TIMEOUT_MS = 8000;
export const TAB_TIMEOUT_MS = 10_000;
// A new window's first tab is looked for this many times, this long apart (ms).
export const WINDOW_TRIES = 50;
export const WINDOW_TRY_MS = 200;
// Settings > Browser: the rule agents get until you write one, and its longest length (UI).
export const DEFAULT_RULE = "Ask me before you do anything on a website that cannot be undone: send a message or an email, buy something, post or publish, delete, or send a form with my personal details.";
export const MAX_RULE = 1000;
