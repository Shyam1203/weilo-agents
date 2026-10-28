import type { Card } from "../proto/Card";
import type { Decision } from "../proto/Decision";
import type { Event } from "../proto/Event";
import type { SendWhen } from "../proto/SendWhen";
import type { StepStatus } from "../proto/StepStatus";

export interface StepItem {
  id: string;
  title: string;
  status: StepStatus;
  at: string;
}

export interface Decided {
  decision: Decision;
  at: string;
  via: string;
}

export type AgentItem =
  | { type: "text"; key: string; text: string }
  | { type: "steps"; key: string; steps: StepItem[] }
  | { type: "card"; key: string; card: Card; decided: Decided | null }
  | { type: "filed"; key: string; channelId: string }
  | { type: "problem"; key: string; message: string; action: string | null };

export type Block =
  | { type: "user"; key: string; text: string; at: string; when: SendWhen }
  | { type: "agent"; key: string; agentId: string | null; at: string; hasText: boolean; items: AgentItem[] };

/**
 * Turns durable events into what the conversation draws: the person's messages, and agent turns
 * that hold text, steps, cards and notices. Steps update in place by `step_id`; a decision is
 * attached to its card. State and usage events draw nothing.
 */
export function buildBlocks(events: Event[], defaultAgentId: string | null = null): Block[] {
  const blocks: Block[] = [];
  const decided = new Map<string, Decided>();
  for (const e of events) {
    if (e.body.kind === "approval_decided") {
      decided.set(e.body.approval_id, { decision: e.body.decision, at: e.at, via: e.body.via });
    }
  }
  const stepIndex = new Map<string, StepItem>();

  const agentBlock = (e: Event, agentId: string | null): Extract<Block, { type: "agent" }> => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === "agent" && (agentId === null || last.agentId === null || last.agentId === agentId)) {
      if (last.agentId === null && agentId) last.agentId = agentId;
      return last;
    }
    const b: Extract<Block, { type: "agent" }> = {
      type: "agent",
      key: `a${e.seq}`,
      agentId,
      at: e.at,
      hasText: false,
      items: [],
    };
    blocks.push(b);
    return b;
  };

  for (const e of events) {
    const body = e.body;
    switch (body.kind) {
      case "user_message":
        blocks.push({ type: "user", key: `u${e.seq}`, text: body.text, at: e.at, when: body.when });
        break;
      case "agent_message": {
        const last = blocks[blocks.length - 1];
        const id = body.agent_id ?? defaultAgentId;
        // A new message from the agent starts a new turn unless the turn so far holds no text.
        const b =
          last && last.type === "agent" && !last.hasText && (last.agentId === null || last.agentId === id)
            ? last
            : null;
        const block = b ?? {
          type: "agent" as const,
          key: `a${e.seq}`,
          agentId: id,
          at: e.at,
          hasText: false,
          items: [],
        };
        if (!b) blocks.push(block);
        block.agentId = block.agentId ?? id;
        if (!block.hasText) block.at = e.at;
        block.hasText = true;
        block.items.push({ type: "text", key: `t${e.seq}`, text: body.text });
        break;
      }
      case "step": {
        const existing = stepIndex.get(body.step_id);
        if (existing) {
          existing.status = body.status;
          existing.title = body.title;
          break;
        }
        const b = agentBlock(e, null);
        const step: StepItem = { id: body.step_id, title: body.title, status: body.status, at: e.at };
        stepIndex.set(body.step_id, step);
        const last = b.items[b.items.length - 1];
        if (last && last.type === "steps") last.steps.push(step);
        else b.items.push({ type: "steps", key: `s${e.seq}`, steps: [step] });
        break;
      }
      case "card": {
        const b = agentBlock(e, null);
        const id = body.card.approval_id;
        b.items.push({ type: "card", key: `c${e.seq}`, card: body.card, decided: id ? (decided.get(id) ?? null) : null });
        break;
      }
      case "filed":
        agentBlock(e, null).items.push({ type: "filed", key: `f${e.seq}`, channelId: body.channel_id });
        break;
      case "problem":
        agentBlock(e, null).items.push({ type: "problem", key: `p${e.seq}`, message: body.message, action: body.action });
        break;
      case "approval_decided":
      case "state":
      case "usage":
        break;
    }
  }
  for (const b of blocks) if (b.type === "agent" && b.agentId === null) b.agentId = defaultAgentId;
  return blocks;
}

/** Every step in a thread, newest status, for the Changes panel. */
export function allSteps(events: Event[]): StepItem[] {
  const map = new Map<string, StepItem>();
  for (const e of events) {
    if (e.body.kind !== "step") continue;
    const prev = map.get(e.body.step_id);
    map.set(e.body.step_id, { id: e.body.step_id, title: e.body.title, status: e.body.status, at: prev?.at ?? e.at });
  }
  return [...map.values()];
}

/** Total cost so far, in micro-dollars. */
export function totalCost(events: Event[]): bigint {
  let sum = 0n;
  for (const e of events) if (e.body.kind === "usage") sum += e.body.cost_micros;
  return sum;
}

/** Plain words for a decision, shown under a decided card. */
export function outcomeWords(decision: Decision, cardKind: string): string {
  switch (decision.kind) {
    case "allow":
      return cardKind === "draft" ? "Approved" : "Allowed";
    case "allow_always":
      return `Always allowed ${scopeWords(decision.scope)}`;
    case "deny":
      return cardKind === "draft" ? "Discarded" : "Not allowed";
  }
}

export function scopeWords(scope: string): string {
  const s = scope.trim().toLowerCase();
  if (s === "folder") return "in this folder";
  if (s === "agent") return "for this agent";
  if (s === "site") return "for this site";
  if (s === "channel") return "in this channel";
  return s.startsWith("in ") || s.startsWith("for ") ? s : `for ${s}`;
}
