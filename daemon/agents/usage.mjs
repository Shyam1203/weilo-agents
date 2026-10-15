import { readJson, updateJson, USAGE } from "../common.mjs";
import { userZone } from "../routines/routines.mjs";
import { dateIn } from "../routines/schedule.mjs";

const today = async () => dateIn(Date.now(), await userZone());

export const tokensOf = (usage) => (usage?.input ?? 0) + (usage?.output ?? 0) + (usage?.cacheWrite ?? 0);

export async function usageToday() {
  const { day, agents = {} } = await readJson(USAGE);
  return day === (await today()) ? agents : {};
}

export async function addUsage(id, tokens) {
  const day = await today();
  const { agents } = await updateJson(USAGE, (data) => {
    const counted = data.day === day ? (data.agents ?? {}) : {};
    return { day, agents: { ...counted, [id]: (counted[id] ?? 0) + tokens } };
  });
  return agents[id];
}
