import type { CardAction } from "../proto/CardAction";
import type { NeedsYouItem } from "../proto/NeedsYouItem";
import type { RiskClass } from "../proto/RiskClass";
import { isSameDay } from "./format";

export type GroupKey = "waiting" | "questions" | "failed" | "expired" | "done";

export interface NeedsYouGroup {
  key: GroupKey;
  title: string;
  /** Only "Waiting on a yes" shows a count. */
  count: number | null;
  items: NeedsYouItem[];
}

const TITLES: Record<GroupKey, string> = {
  waiting: "Waiting on a yes",
  questions: "Questions",
  failed: "Didn't work",
  expired: "Expired",
  done: "Done today",
};

const ORDER: GroupKey[] = ["waiting", "questions", "failed", "expired", "done"];

/** Heads-ups ("Ava started a session") never ask for a yes; they go under Done today. */
export function isHeadsUp(item: NeedsYouItem): boolean {
  return item.card.kind === "heads_up";
}

export function groupOf(item: NeedsYouItem, now: Date): GroupKey | null {
  if (isHeadsUp(item)) return isSameDay(new Date(item.created_at), now) ? "done" : null;
  if (item.card.kind === "failed" || item.card.kind === "problem") return "failed";
  switch (item.state) {
    case "pending":
      return item.card.kind === "question" ? "questions" : "waiting";
    case "expired":
      return "expired";
    case "allowed":
    case "denied":
      return isSameDay(new Date(item.created_at), now) ? "done" : null;
  }
}

/** Groups in a fixed order; empty groups are left out. */
export function groupNeedsYou(items: NeedsYouItem[], now = new Date()): NeedsYouGroup[] {
  const buckets = new Map<GroupKey, NeedsYouItem[]>();
  for (const item of items) {
    const g = groupOf(item, now);
    if (!g) continue;
    const list = buckets.get(g) ?? [];
    list.push(item);
    buckets.set(g, list);
  }
  return ORDER.filter((k) => buckets.get(k)?.length).map((key) => {
    const list = buckets.get(key)!;
    return { key, title: TITLES[key], count: key === "waiting" ? list.length : null, items: list };
  });
}

/** Small items change nothing or can be undone. Only these may be approved with one key. */
export function isSmall(risk: RiskClass): boolean {
  return risk === "read" || risk === "reversible";
}

/** The action that says yes: the primary one with an allow decision, else any allow. */
export function yesAction(actions: CardAction[]): CardAction | undefined {
  const allows = actions.filter((a) => a.decision?.kind === "allow");
  return allows.find((a) => a.primary) ?? allows[0];
}

/**
 * What the A key does on an item: approve a small pending item in place, or open everything else.
 */
export function approveKey(item: NeedsYouItem): { kind: "decide"; action: CardAction } | { kind: "open" } {
  if (item.state === "pending" && !isHeadsUp(item) && isSmall(item.card.risk)) {
    const yes = yesAction(item.card.actions);
    if (yes) return { kind: "decide", action: yes };
  }
  return { kind: "open" };
}

/** Items you can act on, in page order (for J/K). */
export function actionable(groups: NeedsYouGroup[]): NeedsYouItem[] {
  return groups.flatMap((g) => g.items);
}
