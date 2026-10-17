const KEEP_TURNS = 2;
const LONG = 2000;
const KEPT = 400;

const cutText = (text) => `${text.slice(0, KEPT)}\n[… ${text.length - KEPT} more characters left out. Run the tool again if you need them.]`;

function trimResult(m) {
  if (!Array.isArray(m.content)) return m;
  let changed = false;
  const content = m.content.map((b) => {
    if (b.type === "image") return (changed = true), { type: "text", text: "[An image, left out.]" };
    if (b.type === "text" && b.text.length > LONG) return (changed = true), { ...b, text: cutText(b.text) };
    return b;
  });
  return changed ? { ...m, content } : m;
}

export function trimOld(messages) {
  let turns = 0;
  let from = 0;
  for (let i = messages.length - 1; i >= 0; i--)
    if (messages[i].role === "user" && ++turns === KEEP_TURNS) {
      from = i;
      break;
    }
  if (turns < KEEP_TURNS) return messages;
  let changed = false;
  const out = messages.map((m, i) => {
    if (i >= from || m.role !== "toolResult") return m;
    const t = trimResult(m);
    if (t !== m) changed = true;
    return t;
  });
  return changed ? out : messages;
}

const RESULT = 1500;
const ARGS = 300;
const TRANSCRIPT = 120_000;

const textOf = (content) =>
  typeof content === "string"
    ? content
    : (content ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");

const clip = (text, max) => (text.length > max ? `${text.slice(0, max)} [… ${text.length - max} more characters]` : text);

function lineOf(m) {
  if (m.role === "user") return `[User]: ${textOf(m.content)}`;
  if (m.role === "assistant") {
    const parts = [];
    for (const b of m.content ?? []) {
      if (b.type === "text" && b.text.trim()) parts.push(`[Agent]: ${b.text}`);
      if (b.type === "toolCall") parts.push(`[Agent used ${b.name}]: ${clip(JSON.stringify(b.arguments ?? {}), ARGS)}`);
    }
    return parts.join("\n");
  }
  if (m.role === "toolResult") return `[${m.toolName} answered${m.isError ? ", with an error" : ""}]: ${clip(textOf(m.content), RESULT)}`;
  if (m.role === "bashExecution") return `[A command was run]: ${m.command}\n${clip(m.output ?? "", RESULT)}`;
  if (m.role === "compactionSummary" || m.role === "branchSummary") return `[Summary of earlier messages]: ${m.summary}`;
  if (m.role === "custom" && typeof m.content === "string") return `[Note]: ${m.content}`;
  return "";
}

export function transcriptOf(messages) {
  const text = messages.map(lineOf).filter(Boolean).join("\n\n");
  if (text.length <= TRANSCRIPT) return text;
  const head = Math.round(TRANSCRIPT / 4);
  return `${text.slice(0, head)}\n\n[… ${text.length - TRANSCRIPT} characters left out …]\n\n${text.slice(text.length - (TRANSCRIPT - head))}`;
}
