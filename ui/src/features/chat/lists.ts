const ITEM = /^(\s*)(?:([-*•])|(\d{1,3})([.)]))\s+(.*)$/;

export function continueList(text: string, caret: number): { text: string; caret: number } | null {
  const start = text.lastIndexOf("\n", caret - 1) + 1;
  const item = ITEM.exec(text.slice(start, caret));
  if (!item) return null;
  const [, indent, bullet, number, dot, content] = item;
  if (!content.trim()) return { text: text.slice(0, start) + text.slice(caret), caret: start };
  const marker = bullet ?? `${Number(number) + 1}${dot}`;
  const insert = `\n${indent}${marker} `;
  const rest = bullet ? text.slice(caret) : renumber(text.slice(caret), indent, dot, Number(number) + 2);
  return { text: text.slice(0, caret) + insert + rest, caret: caret + insert.length };
}

function renumber(rest: string, indent: string, dot: string, from: number) {
  const [first, ...lines] = rest.split("\n");
  let next = from;
  for (let i = 0; i < lines.length; i++) {
    const item = ITEM.exec(lines[i]);
    if (!item || item[1] !== indent || item[3] === undefined || item[4] !== dot) break;
    lines[i] = lines[i].replace(/\d+/, String(next++));
  }
  return [first, ...lines].join("\n");
}
