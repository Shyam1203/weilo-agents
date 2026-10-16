import { fail, plainText } from "../common.mjs";
import { MAX_SEARCH, SEARCH_RESULTS } from "../config.mjs";
import { profiles } from "./agents.mjs";
import { containing } from "./chats.mjs";

const BEFORE = 50;
const AFTER = 110;

export async function searchChats(query) {
  const text = typeof query === "string" ? query.trim() : "";
  if (!text || text.length > MAX_SEARCH) throw fail(400, "Type what to search for");
  const names = new Map((await profiles()).map((a) => [a.id, a.name]));
  const needle = text.toLowerCase();
  const found = [];
  for (const m of await containing(text, [...names.keys()], SEARCH_RESULTS)) {
    const body = plainText(m.body);
    // The words can be where plain text does not show them (a link's address, say): the message
    // still holds them, so it is shown from its start.
    const at = body.toLowerCase().indexOf(needle);
    const start = at < 0 ? 0 : Math.max(0, at - BEFORE);
    const end = Math.min(body.length, (at < 0 ? 0 : at + needle.length) + AFTER);
    found.push({ agent: m.agent, name: names.get(m.agent), speaker: m.speaker, at: m.at, snippet: `${start ? "…" : ""}${body.slice(start, end)}${end < body.length ? "…" : ""}` });
  }
  return found;
}
