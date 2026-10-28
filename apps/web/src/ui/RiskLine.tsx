import type { RiskClass } from "../proto/RiskClass";
import { cx } from "../lib/format";
import { AlertIcon, CheckIcon } from "./glyphs";

const TONE: Record<RiskClass, string> = {
  read: "text-success",
  reversible: "text-success",
  send: "text-warning",
  destructive: "text-danger",
};

/** One risk line per card, in one place and one style. */
export function RiskLine({ risk, text, className }: { risk: RiskClass; text: string; className?: string }) {
  const safe = risk === "read" || risk === "reversible";
  return (
    <span className={cx("flex min-w-0 items-center gap-1.5 text-caption font-medium", TONE[risk], className)}>
      {safe ? <CheckIcon className="shrink-0" /> : <AlertIcon className="shrink-0" />}
      <span className="ellipsis">{text}</span>
    </span>
  );
}
