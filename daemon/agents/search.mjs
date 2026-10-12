import { fail, plainText } from "../common.mjs";
import { MAX_SEARCH, SEARCH_RESULTS } from "../config.mjs";
import { profiles } from "./agents.mjs";
import { messagesOf } from "./sessions.mjs";

// Characters of a message around what was found, for the result's snippet.
const BEFORE = 50;
const AFTER = 110;

/**
 * Your messages and the agents' that hold `query` (any case), in every agent's chat, newest first:
 * [{ agent: id, name, speaker ("you" | "agent" | "routine"), at (ISO), snippet }].
 */
export async function searchChats(query) {
  const text = typeof query === "string" ? query.trim() : "";
  if (!text || text.length > MAX_SEARCH) throw fail(400, "Type what to search for");
  const needle = text.toLowerCase();
  const found = [];
  for (const agent of await profiles()) {
    for await (const m of messagesOf(agent.id, agent.name)) {
      const body = plainText(m.body);
      const at = body.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      const start = Math.max(0, at - BEFORE);
      const end = Math.min(body.length, at + needle.length + AFTER);
      found.push({ agent: agent.id, name: agent.name, speaker: m.speaker, at: m.at, snippet: `${start ? "…" : ""}${body.slice(start, end)}${end < body.length ? "…" : ""}` });
    }
  }
  return found.sort((a, b) => b.at.localeCompare(a.at)).slice(0, SEARCH_RESULTS);
}
