import type { ChangedFile } from "../proto/ChangedFile";
import type { FileChange } from "../proto/FileChange";

const WORD: Record<FileChange, string> = { added: "New", modified: "Changed", deleted: "Deleted" };

/** One plain word for what happened to a file. */
export function fileChangeWord(status: FileChange): string {
  return WORD[status];
}

/** "1 file changed", "3 files changed". */
export function filesChangedLine(files: ChangedFile[]): string {
  return `${files.length} ${files.length === 1 ? "file" : "files"} changed`;
}

/** "+12 −3", leaving out a side that is 0; empty for binary files (both 0). */
export function lineCounts(f: Pick<ChangedFile, "added" | "removed">): string {
  const parts: string[] = [];
  if (f.added) parts.push(`+${f.added}`);
  if (f.removed) parts.push(`−${f.removed}`);
  return parts.join(" ");
}

export type DiffTone = "add" | "remove" | "file" | "hunk" | "plain";

/** How to colour a line of a diff. */
export function diffTone(line: string): DiffTone {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) return "file";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "remove";
  return "plain";
}

export interface DiffLine {
  kind: "add" | "remove" | "context";
  /** The line's number: in the new file for added and unchanged lines, in the old file for removed ones. */
  no: number;
  text: string;
}

export interface DiffHunk {
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
  binary: boolean;
  hunks: DiffHunk[];
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function stripSide(p: string): string {
  const t = p.trim().replace(/^"(.*)"$/, "$1").replace(/\t.*$/, "");
  return t.replace(/^[ab]\//, "");
}

/**
 * A git diff as files people can read: each file's name, its +N −M, and its changed parts
 * with line numbers. The machine headers (diff, index, ---, +++, modes) are dropped.
 */
export function parseDiff(diff: string | null | undefined): DiffFile[] {
  const files: DiffFile[] = [];
  if (!diff) return files;
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;
  const start = (path: string): DiffFile => {
    const f: DiffFile = { path, added: 0, removed: 0, binary: false, hunks: [] };
    files.push(f);
    hunk = null;
    oldLeft = newLeft = 0;
    return f;
  };
  const lines = diff.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const inHunk = hunk !== null && (oldLeft > 0 || newLeft > 0);
    if (inHunk) {
      const h: DiffHunk = hunk!;
      const sign = line[0];
      if (sign === "+") {
        h.lines.push({ kind: "add", no: newNo++, text: line.slice(1) });
        file!.added++;
        newLeft--;
        continue;
      }
      if (sign === "-") {
        h.lines.push({ kind: "remove", no: oldNo++, text: line.slice(1) });
        file!.removed++;
        oldLeft--;
        continue;
      }
      if (sign === " " || line === "") {
        // An empty line inside a hunk is an unchanged empty line (some tools drop the space).
        if (line === "" && i === lines.length - 1) continue;
        h.lines.push({ kind: "context", no: newNo++, text: line.slice(1) });
        oldNo++;
        oldLeft--;
        newLeft--;
        continue;
      }
      if (line.startsWith("\\")) continue;
      // Anything else ends the hunk early; read it as a header below.
      oldLeft = newLeft = 0;
    }
    if (line.startsWith("\\")) continue;
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git (?:"?a\/)?(.+?)"? (?:"?b\/)(.+?)"?$/.exec(line);
      file = start(m ? m[2]! : stripSide(line.slice(11).split(" ").pop() ?? ""));
      continue;
    }
    if (line.startsWith("--- ")) {
      // A plain unified diff has no "diff --git" line: "---" starts the file.
      if (!file || file.hunks.length > 0) file = start(stripSide(line.slice(4)));
      const p = stripSide(line.slice(4));
      if (p !== "/dev/null" && !file.path) file.path = p;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const p = stripSide(line.slice(4));
      if (file && p !== "/dev/null") file.path = p;
      continue;
    }
    if (line.startsWith("rename to ")) {
      if (file) file.path = line.slice(10).trim();
      continue;
    }
    if (/^Binary files .* differ$/.test(line)) {
      if (file) file.binary = true;
      continue;
    }
    const m = HUNK.exec(line);
    if (m) {
      if (!file) file = start("");
      hunk = { lines: [] };
      file.hunks.push(hunk);
      oldNo = Number(m[1]);
      newNo = Number(m[3]);
      oldLeft = m[2] === undefined ? 1 : Number(m[2]);
      newLeft = m[4] === undefined ? 1 : Number(m[4]);
      continue;
    }
    // index, mode, similarity and other machine lines: not shown.
  }
  return files;
}
