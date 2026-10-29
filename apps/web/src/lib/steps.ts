import type { StepItem } from "./timeline";

/**
 * Engines name their steps after their tools ("ToolSearch", "Read /path/file.ts",
 * "`npm test`"). People see plain words; the file or command stays under Show details.
 */
export interface PlainStep {
  /** What people see: "Read theme.css", "Ran the tests". */
  label: string;
  /** The plain kind of step ("Read a file"), for counting failures. */
  kind: string;
  /** The file, command or address, when the title named one. */
  detail: string | null;
  /** Reading or looking: a failure here is folded into details. */
  quiet: boolean;
}

const WORDS: Array<[RegExp, string, boolean]> = [
  [/^(toolsearch|tool_search)$/, "Got its tools ready", true],
  [/^(read|readfile|read_file|readmanyfiles|read_many_files|view|cat|open)$/, "Read a file", true],
  [/^(bash|execute|exec|shell|run|run_shell_command|runcommand|terminal|command|killshell|bashoutput)$/, "Ran a command", false],
  [/^(edit|multiedit|write|writefile|write_file|replace|create|patch|apply_patch|applypatch|notebookedit|delete|move)$/, "Changed a file", false],
  [/^(fetch|webfetch|web_fetch|browse|open_url)$/, "Opened a web page", true],
  [/^(websearch|web_search|google_web_search|searchweb)$/, "Searched the web", true],
  [/^(grep|glob|find|search|ls|list|list_directory|listdirectory|search_file_content|codebase_search)$/, "Looked through files", true],
  [/^(task|agent|subagent)$/, "Asked a helper", false],
  [/^(todowrite|todo_write|todoread|update_plan|plan)$/, "Updated the to-do list", true],
  [/^(think|thinking)$/, "Thought it through", true],
];

const PHRASES: Record<string, string> = {
  "read file": "read",
  "write file": "write",
  "edit file": "edit",
  "run command": "bash",
  "update todos": "todowrite",
  "web search": "websearch",
};

/** True when the rest of a title is a path, a command, an address or a pattern, not words. */
function technical(rest: string): boolean {
  return (
    /^[`"'~/.\\[{(*$-]/.test(rest) ||
    /:\/\//.test(rest) ||
    /[/\\]/.test(rest) ||
    /\.[a-z0-9]{1,6}(\s|$|:)/i.test(rest) ||
    /^[\w.-]+$/.test(rest) && /[._-]/.test(rest)
  );
}

function stripTicks(s: string): string {
  const t = s.trim();
  return t.length > 1 && t.startsWith("`") && t.endsWith("`") ? t.slice(1, -1).trim() : t;
}

export function plainStep(title: string): PlainStep {
  const raw = title.trim();
  if (!raw) return plain("Did a step", null, true);
  // A whole command in backticks: "`npm test`".
  if (/^`[^`]+`$/.test(raw)) return withObject(plain("Ran a command", stripTicks(raw), false));
  // MCP tools: "mcp__server__tool".
  if (/^mcp__/i.test(raw)) return plain("Used a connection", raw, true);

  const lower = raw.toLowerCase();
  for (const [phrase, tool] of Object.entries(PHRASES)) {
    if (lower === phrase || lower.startsWith(`${phrase} `)) {
      const rest = raw.slice(phrase.length).trim();
      return match(tool, rest) ?? plain(raw, null, false);
    }
  }
  const m = /^([A-Za-z_]+)(?::\s*|\s+|$)(.*)$/s.exec(raw);
  if (m) {
    const found = match(m[1]!.toLowerCase(), m[2]!.trim());
    if (found) return found;
  }
  return plain(raw, null, false);
}

function plain(label: string, detail: string | null, quiet: boolean): PlainStep {
  return { label, kind: label, detail, quiet };
}

function match(tool: string, rest: string): PlainStep | null {
  const hit = WORDS.find(([re]) => re.test(tool));
  if (!hit) return null;
  // "Read the checkout code" is already plain words; only tool-like titles are renamed.
  if (rest && !technical(rest)) return null;
  return withObject(plain(hit[1], rest ? stripTicks(rest) : null, hit[2]));
}

/** The file's name without its folders: "src/theme.css" → "theme.css". */
function fileName(path: string): string | null {
  const first = path.split(/\s+/)[0]!.replace(/[:,]+$/, "");
  const name = first.split(/[/\\]/).filter(Boolean).pop();
  return name && name.length <= 48 ? name : null;
}

// Common commands, said in plain words. Anything else stays "Ran a command".
const COMMANDS: Array<[RegExp, string]> = [
  [/^(npm|pnpm|yarn|bun)( run)? (test|vitest|jest)\b|^(npx )?(vitest|jest|pytest|mocha)\b|^cargo (test|nextest)\b|^go test\b|^make test\b/, "Ran the tests"],
  [/^(npm|pnpm|yarn|bun)( run)? build\b|^cargo build\b|^go build\b|^make\b|^(npx )?(tsc|vite build)\b/, "Built the project"],
  [/^(npm|pnpm|yarn|bun) (install|i|add|ci)\b|^pip3? install\b|^cargo add\b|^brew install\b/, "Installed what it needs"],
  [/^(npm|pnpm|yarn|bun)( run)? (lint|format|fmt)\b|^(npx )?(eslint|prettier|biome)\b|^cargo (fmt|clippy)\b|^ruff\b/, "Checked the code style"],
  [/^(npm|pnpm|yarn|bun)( run)? (dev|start|serve)\b/, "Started the app"],
  [/^git (status|diff|log|show)\b/, "Looked at the changes"],
  [/^git (add|commit)\b/, "Saved the changes"],
  [/^git (checkout|switch|branch)\b/, "Switched branches"],
  [/^git (pull|fetch)\b/, "Got the latest changes"],
  [/^git push\b/, "Sent the changes"],
  [/^(ls|tree|pwd)\b/, "Looked through files"],
  [/^(cat|head|tail|less)\s/, "Read a file"],
  [/^(rg|grep|find|fd)\s/, "Looked through files"],
  [/^(mkdir|touch|cp|mv)\s/, "Changed files"],
  [/^rm\s/, "Deleted files"],
  [/^curl\b|^wget\b/, "Opened a web page"],
];

/** Adds the object when the step names one: the file's name, or the command in plain words. */
function withObject(p: PlainStep): PlainStep {
  if (!p.detail) return p;
  switch (p.kind) {
    case "Read a file":
    case "Changed a file": {
      const name = fileName(p.detail);
      return name ? { ...p, label: `${p.kind === "Read a file" ? "Read" : "Changed"} ${name}` } : p;
    }
    case "Ran a command": {
      const cmd = p.detail.replace(/^(cd \S+ && |sudo )+/, "").trim();
      const hit = COMMANDS.find(([re]) => re.test(cmd));
      return hit ? { ...p, label: hit[1] } : p;
    }
    case "Opened a web page": {
      const host = /^[a-z]+:\/\/(?:www\.)?([^/:?#]+)/i.exec(p.detail)?.[1];
      return host ? { ...p, label: `Opened ${host}` } : p;
    }
    default:
      return p;
  }
}

export interface ShownSteps {
  /** Steps shown as plain lines. `saysFailed`: the label already says it didn't work ("Couldn't change app.ts"). */
  shown: Array<StepItem & { label: string; saysFailed?: boolean }>;
  /** Every step's original title, for Show details. Empty when there is nothing more to see. */
  details: Array<StepItem & { label: string; detail: string | null }>;
  /** How many failed look-ups were folded away. */
  folded: number;
  /** Those failures in plain words ("1 file couldn't be read"), shown with the fold; null when none. */
  failedLine: string | null;
}

const FAILED_WORDS: Record<string, [string, string]> = {
  "Read a file": ["file couldn't be read", "files couldn't be read"],
  "Opened a web page": ["web page couldn't be opened", "web pages couldn't be opened"],
  "Searched the web": ["web search didn't work", "web searches didn't work"],
  "Looked through files": ["file search didn't work", "file searches didn't work"],
  "Got its tools ready": ["tool wasn't found", "tools weren't found"],
};

/** "1 file couldn't be read", "2 web pages couldn't be opened"; mixed kinds: "3 steps didn't work". */
export function failedLine(labels: string[]): string | null {
  const n = labels.length;
  if (n === 0) return null;
  const kinds = new Set(labels);
  const words = kinds.size === 1 ? FAILED_WORDS[labels[0]!] : undefined;
  if (words) return `${n} ${n === 1 ? words[0] : words[1]}`;
  return `${n} ${n === 1 ? "step didn't work" : "steps didn't work"}`;
}

/**
 * What a list of steps shows: plain labels, with failed reads and look-ups (an engine
 * peeking at its own memory files, say) folded into the details.
 */
export function showSteps(steps: StepItem[]): ShownSteps {
  const shown: ShownSteps["shown"] = [];
  const details: ShownSteps["details"] = [];
  let folded = 0;
  const failed: string[] = [];
  let extra = false;
  for (const s of steps) {
    const p = plainStep(s.title);
    details.push({ ...s, label: p.label, detail: p.detail });
    // Details are worth opening only for what the lines leave out: a file, a command, an address.
    if (p.detail) extra = true;
    if (s.status === "failed" && p.quiet) {
      folded += 1;
      failed.push(p.kind);
      extra = true;
      continue;
    }
    if (s.status === "failed" && p.kind === "Changed a file") {
      const name = p.detail ? fileName(p.detail) : null;
      shown.push({ ...s, label: name ? `Couldn't change ${name}` : "Couldn't change a file", saysFailed: true });
      continue;
    }
    shown.push({ ...s, label: p.label });
  }
  return { shown, details: extra ? details : [], folded, failedLine: failedLine(failed) };
}
