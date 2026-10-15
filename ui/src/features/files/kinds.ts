export type Kind = "image" | "pdf" | "markdown" | "csv" | "json" | "html" | "text" | "other";

const BY_EXTENSION: Record<string, Kind> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image",
  pdf: "pdf",
  md: "markdown", markdown: "markdown",
  csv: "csv", tsv: "csv",
  json: "json", jsonl: "text",
  html: "html", htm: "html",
};
const TEXT = "txt log yaml yml toml xml css js mjs ts tsx jsx py sh sql java go rs c cpp h rb php ini".split(" ");

export function kindOf(path: string): Kind {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[ext] ?? (TEXT.includes(ext) ? "text" : "other");
}

const FULL = /^\/home\/node\/\.pi\/(?:workspace|isolated)\/([^\s`]+\.[A-Za-z0-9]{1,8})$/;
const RELATIVE = /^(?:\.\/)?([^\s`/:~.][^\s`/:.]*\/[^\s`:]*\.[A-Za-z0-9]{1,8})$/;

export function workspacePath(text: string): string | null {
  const t = text.trim();
  const full = FULL.exec(t);
  const m = full ?? RELATIVE.exec(t);
  if (!m || m[1].split("/").includes("..")) return null;
  return full ? t : kindOf(m[1]) !== "other" ? m[1] : null;
}

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
