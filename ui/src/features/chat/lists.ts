// The message box knows lists: a new line after "- item" or "1. item" starts the next item, and a new line after an empty
// item ends the list, as in a notes app.
const ITEM = /^(\s*)(?:([-*•])|(\d+)([.)]))\s+(.*)$/;

/**
 * What a new line at `caret` does in a list: the text and caret after it. Null when the caret is not at the end of
 * a list item (then the new line is just a new line).
 */
export function continueList(text: string, caret: number): { text: string; caret: number } | null {
  const start = text.lastIndexOf("\n", caret - 1) + 1;
  const item = ITEM.exec(text.slice(start, caret));
  if (!item) return null;
  const [, indent, bullet, number, dot, content] = item;
  // An empty item ends the list: its marker goes.
  if (!content.trim()) return { text: text.slice(0, start) + text.slice(caret), caret: start };
  const marker = bullet ?? `${Number(number) + 1}${dot}`;
  const insert = `\n${indent}${marker} `;
  return { text: text.slice(0, caret) + insert + text.slice(caret), caret: caret + insert.length };
}
