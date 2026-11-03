import { cx } from "../lib/format";

const COLORS: Record<string, string> = {
  violet: "bg-violet-bg text-violet-fg",
  sky: "bg-sky-bg text-sky-fg",
  rose: "bg-rose-bg text-rose-fg",
  teal: "bg-teal-bg text-teal-fg",
};

export function avatarColor(color: string | undefined): string {
  return COLORS[color ?? ""] ?? COLORS.violet!;
}

const SIZES = {
  20: "size-5 text-caption",
  24: "size-6 text-caption",
  32: "size-8 text-caption",
  80: "size-20 text-title",
};

export interface AvatarProps {
  name: string;
  color?: string;
  size?: keyof typeof SIZES;
  /** A white ring, for overlapping faces. */
  ring?: boolean;
  /**
   * On a selected row (accent-subtle). The violet face has the same fill as that row,
   * so it gets a surface ring to stay visible.
   */
  selected?: boolean;
  className?: string;
}

/** A face means an agent. Decorative: the name is always written next to it or in a label. */
export function Avatar({ name, color, size = 24, ring, selected, className }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
        SIZES[size],
        avatarColor(color),
        (ring || selected) && "shadow-ring-surface",
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** The square code icon means a session. */
export function SessionMark({ size = 24, selected }: { size?: 24 | 32; selected?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex shrink-0 items-center justify-center text-text-secondary",
        size === 24 ? "size-6 rounded-sm" : "size-8 rounded-md",
        selected ? "bg-surface" : "bg-surface-muted",
      )}
    >
      <svg
        width={size === 24 ? 14 : 16}
        height={size === 24 ? 14 : 16}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={size === 24 ? 2 : 1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 8l-4 4 4 4M16 8l4 4-4 4" />
      </svg>
    </span>
  );
}
