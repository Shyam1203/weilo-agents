// What the chat can show of a file, by its name.
export type Kind = "image" | "pdf" | "markdown" | "csv" | "json" | "html" | "text" | "other";

const BY_EXTENSION: Record<string, Kind> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image",
  pdf: "pdf",
  md: "markdown", markdown: "markdown",
  csv: "csv", tsv: "csv",
  json: "json", jsonl: "text",
  html: "html", htm: "html",
};
// Must match the extensions the daemon serves as text (daemon/http/files.mjs).
const TEXT = "txt log yaml yml toml xml css js mjs ts tsx jsx py sh sql java go rs c cpp h rb php ini".split(" ");

export function kindOf(path: string): Kind {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[ext] ?? (TEXT.includes(ext) ? "text" : "other");
}

/** A file in the workspace named in an agent's text, as a path inside the workspace; null for anything else. */
export function workspacePath(text: string): string | null {
  const m = /^(?:\/home\/node\/\.pi\/workspace\/)([^\s`]+\.[A-Za-z0-9]{1,8})$/.exec(text.trim());
  return m && !m[1].split("/").includes("..") ? m[1] : null;
}

/** Rows of a comma (or tab) separated file; quoted cells may hold the separator, quotes ("") and line breaks. */
export function parseTable(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"', i++);
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === separator) (row.push(cell), (cell = ""));
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (row.length || cell) rows.push([...row, cell]);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}
