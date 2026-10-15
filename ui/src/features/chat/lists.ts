const ITEM = /^(\s*)(?:([-*•])|(\d+)([.)]))\s+(.*)$/;

export function continueList(text: string, caret: number): { text: string; caret: number } | null {
  const start = text.lastIndexOf("\n", caret - 1) + 1;
  const item = ITEM.exec(text.slice(start, caret));
  if (!item) return null;
  const [, indent, bullet, number, dot, content] = item;
  if (!content.trim()) return { text: text.slice(0, start) + text.slice(caret), caret: start };
  const marker = bullet ?? `${Number(number) + 1}${dot}`;
  const insert = `\n${indent}${marker} `;
  return { text: text.slice(0, caret) + insert + text.slice(caret), caret: caret + insert.length };
}
