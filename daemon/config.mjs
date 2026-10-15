const MINUTE = 60_000;

export const PORT = 3210;
export const MAX_BODY = 64e6;

export const PAIR_CODE_MS = 10 * MINUTE;
export const PAIR_WRONG_CODES = 10;
export const DEVICE_COOKIE_S = 400 * 24 * 60 * 60;
export const DEVICE_SEEN_MS = 60 * MINUTE;
export const ADMIN_SOCKET = "/tmp/weilo-admin/admin.sock";
export const SANDBOX_DIR = "/run/weilo-sandbox";
export const SANDBOX_CTL = `${SANDBOX_DIR}/ctl.sock`;
export const SANDBOX_API = `${SANDBOX_DIR}/api.sock`;
export const MAX_SPEC = 1 << 20;

export const CONTACT_URL = "https://api.weilo.xyz/public/contact";
export const CONTACT_TIMEOUT_MS = 15_000;
export const RELEASES_URL = "https://api.github.com/repos/Shyam1203/weilo-agents/releases/latest";
export const UPDATE_CACHE_MS = 6 * 60 * MINUTE;
export const UPDATE_TIMEOUT_MS = 10_000;
export const MAX_CONTACT_NAME = 100;
export const MAX_CONTACT_EMAIL = 254;
export const MAX_CONTACT_MESSAGE = 4000;

export const PUSH_SUBJECT = "https://github.com/Shyam1203/weilo-agents";
export const PUSH_SEEN_MS = 15_000;
export const PUSH_TTL_S = 24 * 60 * 60;
export const PUSH_TIMEOUT_MS = 10_000;
export const PUSH_BODY_CHARS = 180;

export const STALE_DEVICE_DAYS = 90;
export const USAGE_DAYS = 31;
export const USAGE_SHOWN = 14;

export const BROWSER_UID = 1000;
export const CURATOR_UID = 1100;
export const PLUGINS_UID = 1200;
export const AGENTS_GID = 2000;
export const FIRST_AGENT_UID = 2001;
export const PLUGIN_UID_OFFSET = 100_000;
export const REGULAR_HOME = { mode: 0o2770, tree: "ug+rwX,o-rwx", file: 0o660 };
export const ISOLATED_HOME = { mode: 0o2775, tree: "ug+rwX,o+rX,o-w", file: 0o664 };
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
  unshare: "/usr/bin/unshare",
  mount: "/usr/bin/mount",
  tini: "/usr/bin/tini",
};

export const PI_TOOLS = ["read", "bash", "edit", "write"];
export const SHARED_TOOLS = ["skill", "memory", "fetch_knowledge", "manage_settings", "ask_agent"];
export const CORE_TOOLS = ["show", "ask", "manage_agents", ...SHARED_TOOLS];
export const PI_BUILTINS = ["mcp", "codemode", "tool-search", "llama.cpp"];
export const RESERVED_TOOLS = [...new Set([...PI_TOOLS, ...CORE_TOOLS, "codemode"])];
export const IDLE_MS = 10 * MINUTE;
export const PI_KILL_MS = 5000;
export const PREVIEW_TAIL = 64 * 1024;
export const PREVIEW_CHARS = 140;
export const EARLIER_PAGE = 60;
export const MAX_APPROVAL = 20_000;
export const MAX_SEARCH = 200;
export const SEARCH_RESULTS = 50;

export const PROVIDERS = [
  { id: "anthropic", name: "Anthropic", keyUrl: "https://console.anthropic.com/settings/keys", signIn: "Claude Pro or Max" },
  { id: "openai", name: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", signIn: "ChatGPT Plus or Pro" },
  { id: "github-copilot", name: "GitHub Copilot", signIn: "GitHub Copilot" },
  { id: "openrouter", name: "OpenRouter", keyUrl: "https://openrouter.ai/keys", signIn: "OpenRouter" },
  { id: "google", name: "Google Gemini", keyUrl: "https://aistudio.google.com/apikey" },
];
export const PI_PACKAGE = "/opt/pi/node_modules/@earendil-works/pi-coding-agent";
export const PI_SDK = `${PI_PACKAGE}/dist/index.js`;
export const SIGN_IN_AS = "Weilo Agents";
export const SIGN_IN_TIMEOUT_MS = 15 * MINUTE;
export const SIGN_IN_STEP_MS = 8000;
export const MODELS_TIMEOUT_MS = 90_000;
export const MODELS_FOR_MS = 10 * MINUTE;
export const COMPACT_AT = (window) => (window >= 1e6 ? 0.4 : window >= 5e5 ? 0.8 : 0.9);
export const MIN_RESERVE = 16384;
export const PLUGIN_STATUS_TIMEOUT_MS = 90_000;
export const MAX_UNZIPPED = 50e6;
export const SKILL_DEPTH = 3;
export const MAX_NAME = 100;
export const MAX_SKILL_DESCRIPTION = 1024;
export const MAX_SKILL_TEXT = 60_000;
export const MAX_ABOUT = 4000;

export const MAX_NOTES = 40;
export const MAX_NOTES_CHARS = 3500;
export const NOTE_KINDS = ["preference", "fact", "goal", "person", "project", "decision"];
export const NOTE_STALE_MONTHS = 12;
export const MAX_NOTE = 200;
export const SIMILAR = 0.7;

export const FETCH_TOP = 5;
export const FETCH_EXCERPT = 480;
export const FETCH_MAX_CHARS = 1800;
export const CHAT_TAIL = 32e6;
export const CHAT_CHUNK = 1 << 20;

export const CURATOR_EVERY_MS = 5 * MINUTE;
export const CURATOR_QUIET_MS = 10 * MINUTE;
export const CURATOR_MAX_GAP_MS = 12 * 60 * MINUTE;
export const CURATOR_TIMEOUT_MS = 10 * MINUTE;
export const CURATOR_MAX_INPUT = 24000;
export const CURATOR_MAX_PIECES = 6;
export const CURATOR_MAX_MESSAGE = 1500;
export const CURATOR_MAX_FAILURES = 3;

export const ROUTINES_EVERY_MS = 30_000;
export const MAX_ROUTINES = 50;
export const MAX_TIMES = 6;
export const MAX_ROUTINE_TITLE = 80;
export const MAX_ROUTINE_TASK = 4000;
export const MAX_IN_MINUTES = 525_600;
export const LATE_MS = 60 * MINUTE;
export const SEND_MS = MINUTE;

export const SCREEN = { width: 1280, height: 800 };
export const SCREEN_RESTART_MS = 2000;
export const MAX_VIEW_MESSAGE = 1 << 20;
export const SNAPSHOT_MAX = 15_000;
export const SETTLE_MS = 600;
export const CONNECT_TIMEOUT_MS = 15_000;
export const LOAD_TIMEOUT_MS = 30_000;
export const BACK_TIMEOUT_MS = 15_000;
export const ELEMENT_TIMEOUT_MS = 8000;
export const CONTENT_TIMEOUT_MS = 5000;
export const SNAPSHOT_TIMEOUT_MS = 8000;
export const TAB_TIMEOUT_MS = 10_000;
export const WINDOW_TRIES = 50;
export const WINDOW_TRY_MS = 200;
export const DEFAULT_RULE = "Ask me before you do anything on a website that cannot be undone: send a message or an email, buy something, post or publish, delete, or send a form with my personal details.";
export const MAX_RULE = 1000;
