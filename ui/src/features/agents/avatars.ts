import type { Agent } from "../../api/agents";
import { COLORS, SHAPES, type AvatarSpec } from "../../components/ui/Avatar";

const KINDS = Object.keys(SHAPES);

const hashOf = (text: string) => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

export function avatarOf(agent: Pick<Agent, "id" | "avatar">): AvatarSpec {
  if (agent.avatar && SHAPES[agent.avatar.shape]) return agent.avatar;
  const h = hashOf(agent.id);
  return { shape: KINDS[h % KINDS.length], color: COLORS[Math.floor(h / KINDS.length) % COLORS.length] };
}

export const randomAvatar = (): AvatarSpec => ({ shape: KINDS[Math.floor(Math.random() * KINDS.length)], color: COLORS[Math.floor(Math.random() * COLORS.length)] });
