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
