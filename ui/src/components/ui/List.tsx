import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { Card } from "./Row";

/** A card of rows, or the empty state when there are none. */
export function List<T>({ items, empty, children }: { items: T[]; empty: ReactNode; children: (item: T) => ReactNode }) {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return <Card>{items.map(children)}</Card>;
}

const Empty = ({ children }: { children: ReactNode }) => <div className="rounded-2xl border border-dashed border-line-strong px-5 py-8 text-center text-[13px] leading-relaxed text-ink-3">{children}</div>;

export const Loading = ({ label = "Loading…" }: { label?: string }) => (
  <p className="flex items-center gap-2 text-[13px] text-ink-3">
    <Icon name="spinner" size={14} /> {label}
  </p>
);
