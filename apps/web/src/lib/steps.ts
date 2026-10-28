import type { StepItem } from "./timeline";

/**
 * Engines name their steps after their tools ("ToolSearch", "Read /path/file.ts",
 * "`npm test`"). People see plain words; the file or command stays under Show details.
 */
export interface PlainStep {
  label: string;
  /** The file, command or address, when the title named one. */
  detail: string | null;
  /** Reading or looking: a failure here is folded into details. */
  quiet: boolean;
}

const WORDS: Array<[RegExp, string, boolean]> = [
  [/^(toolsearch|tool_search)$/, "Looked for a tool", true],
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
  if (!raw) return { label: "Did a step", detail: null, quiet: true };
  // A whole command in backticks: "`npm test`".
  if (/^`[^`]+`$/.test(raw)) return { label: "Ran a command", detail: stripTicks(raw), quiet: false };
  // MCP tools: "mcp__server__tool".
  if (/^mcp__/i.test(raw)) return { label: "Used a connection", detail: raw, quiet: true };

  const lower = raw.toLowerCase();
  for (const [phrase, tool] of Object.entries(PHRASES)) {
    if (lower === phrase || lower.startsWith(`${phrase} `)) {
      const rest = raw.slice(phrase.length).trim();
      return match(tool, rest) ?? { label: raw, detail: null, quiet: false };
    }
  }
  const m = /^([A-Za-z_]+)(?::\s*|\s+|$)(.*)$/s.exec(raw);
  if (m) {
    const found = match(m[1]!.toLowerCase(), m[2]!.trim());
    if (found) return found;
  }
  return { label: raw, detail: null, quiet: false };
}

function match(tool: string, rest: string): PlainStep | null {
  const hit = WORDS.find(([re]) => re.test(tool));
  if (!hit) return null;
  // "Read the checkout code" is already plain words; only tool-like titles are renamed.
  if (rest && !technical(rest)) return null;
  return { label: hit[1], detail: rest ? stripTicks(rest) : null, quiet: hit[2] };
}

export interface ShownSteps {
  /** Steps shown as plain lines. */
  shown: Array<StepItem & { label: string }>;
  /** Every step's original title, for Show details. Empty when there is nothing more to see. */
  details: Array<StepItem & { label: string; detail: string | null }>;
  /** How many failed look-ups were folded away. */
  folded: number;
}

/**
 * What a list of steps shows: plain labels, with failed reads and look-ups (an engine
 * peeking at its own memory files, say) folded into the details.
 */
export function showSteps(steps: StepItem[]): ShownSteps {
  const shown: ShownSteps["shown"] = [];
  const details: ShownSteps["details"] = [];
  let folded = 0;
  let extra = false;
  for (const s of steps) {
    const p = plainStep(s.title);
    details.push({ ...s, label: p.label, detail: p.detail });
    if (p.label !== s.title) extra = true;
    if (s.status === "failed" && p.quiet) {
      folded += 1;
      extra = true;
      continue;
    }
    shown.push({ ...s, label: p.label });
  }
  return { shown, details: extra ? details : [], folded };
}
