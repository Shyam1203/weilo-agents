import type { HTMLAttributes } from "react";
import { cx } from "../lib/format";

/** Cards: surface, a hairline border, radius 12 (16 on phones), e1. */
export function Card({ className, phone, ...rest }: HTMLAttributes<HTMLElement> & { phone?: boolean }) {
  return (
    <section
      className={cx(
        "border border-border bg-surface shadow-e1",
        phone ? "rounded-xl" : "rounded-lg",
        className,
      )}
      {...rest}
    />
  );
}
