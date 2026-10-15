// Parses JSON that is still arriving: closes the open string, arrays and objects, and drops a
// trailing key or comma, so a tool call's arguments can be drawn before the call is complete.
export function partialJson(text: string): unknown {
  const closers: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") closers.push("}");
    else if (ch === "[") closers.push("]");
    else if (ch === "}" || ch === "]") closers.pop();
  }
  let head = text;
  if (inString) head = (escaped ? head.slice(0, -1) : head).replace(/\\u[0-9a-fA-F]{0,3}$/, "") + '"';
  const tail = closers.reverse().join("");
  // Try as is, then without a dangling key, colon or comma at the end.
  for (const attempt of [head, head.replace(/,\s*"(?:[^"\\]|\\.)*"\s*:?\s*$/, ""), head.replace(/[,:]\s*$/, "")]) {
    try {
      return JSON.parse(attempt + tail);
    } catch {}
  }
  return undefined;
}
