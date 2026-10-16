import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { CHATS, openChat, readJson, updateJson, USAGE } from "../common.mjs";
import { USAGE_DAYS } from "../config.mjs";
import { userZone } from "../routines/routines.mjs";
import { dateIn } from "../routines/schedule.mjs";

const dayOf = async (ms, back = 0) => dateIn(ms, await userZone(), -back);

export const tokensOf = (usage) => (usage?.input ?? 0) + (usage?.output ?? 0) + (usage?.cacheWrite ?? 0);
const costOf = (usage) => usage?.cost?.total ?? 0;
const daysOf = ({ days, day, agents }) => days ?? (day ? { [day]: Object.fromEntries(Object.entries(agents ?? {}).map(([id, tokens]) => [id, { tokens, cost: 0 }])) } : {});

export async function usageToday() {
  const days = daysOf(await readJson(USAGE));
  return Object.fromEntries(Object.entries(days[await dayOf(Date.now())] ?? {}).map(([id, used]) => [id, used.tokens]));
}

export async function addUsage(id, usage) {
  const day = await dayOf(Date.now());
  const { days } = await updateJson(USAGE, (data) => {
    const all = daysOf(data);
    const was = all[day]?.[id] ?? { tokens: 0, cost: 0 };
    const next = { ...all, [day]: { ...all[day], [id]: { tokens: was.tokens + tokensOf(usage), cost: was.cost + costOf(usage) } } };
    return { ...kept(data), days: recent(next) };
  });
  return days[day][id].tokens;
}

const recent = (days) => Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).slice(-USAGE_DAYS));
const kept = ({ backfilled }) => (backfilled ? { backfilled } : {});

// Usage was only counted from the day the Usage page came; the chats themselves keep each reply's
// usage. Count it from them once, keeping the larger of the two for each day and agent.
export async function backfillUsage() {
  if ((await readJson(USAGE)).backfilled) return;
  const zone = await userZone();
  const found = {};
  const ids = new Set((await Promise.all(CHATS.map((top) => readdir(top).catch(() => [])))).flat().filter((id) => /^[a-z0-9-]+$/.test(id)));
  for (const id of ids) {
    for (const top of CHATS) {
      const files = (await readdir(join(top, id)).catch(() => [])).filter((f) => f.endsWith(".jsonl"));
      for (const f of files) await countChat(join(top, id, f), id, zone, found);
    }
  }
  await updateJson(USAGE, (data) => {
    const days = daysOf(data);
    for (const [day, agents] of Object.entries(found)) {
      for (const [id, used] of Object.entries(agents)) {
        const was = days[day]?.[id];
        if (!was || used.tokens > was.tokens) days[day] = { ...days[day], [id]: used };
      }
    }
    return { days: recent(days), backfilled: true };
  });
}

async function countChat(path, id, zone, found) {
  const file = await openChat(path).catch(() => null);
  if (!file) return;
  try {
    for await (const line of createInterface({ input: file.createReadStream({ encoding: "utf8" }), crlfDelay: Infinity })) {
      if (!line.includes('"usage"')) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const { message } = entry;
      if (entry.type !== "message" || message?.role !== "assistant" || !message.usage) continue;
      const day = dateIn(message.timestamp ?? Date.parse(entry.timestamp), zone);
      const was = found[day]?.[id] ?? { tokens: 0, cost: 0 };
      found[day] = { ...found[day], [id]: { tokens: was.tokens + tokensOf(message.usage), cost: was.cost + costOf(message.usage) } };
    }
  } finally {
    await file.close().catch(() => {});
  }
}

export async function usageHistory(count) {
  const days = daysOf(await readJson(USAGE));
  const wanted = await Promise.all(Array.from({ length: count }, (_, i) => dayOf(Date.now(), count - 1 - i)));
  return wanted.map((day) => ({ day, agents: days[day] ?? {} }));
}
