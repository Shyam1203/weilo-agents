import { readJson, updateJson, USAGE } from "../common.mjs";
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
    return { days: Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)).slice(-USAGE_DAYS)) };
  });
  return days[day][id].tokens;
}

export async function usageHistory(count) {
  const days = daysOf(await readJson(USAGE));
  const wanted = await Promise.all(Array.from({ length: count }, (_, i) => dayOf(Date.now(), count - 1 - i)));
  return wanted.map((day) => ({ day, agents: days[day] ?? {} }));
}
