import type { RiskClass } from "../proto/RiskClass";
import { cx } from "../lib/format";
import { AlertIcon, CheckIcon } from "./glyphs";

/** Red is kept for the confirm step of a destructive action (§11.5), so rows and cards use warning at most. */
const TONE: Record<RiskClass, string> = {
  read: "text-success",
  reversible: "text-success",
  send: "text-warning",
  destructive: "text-warning",
};

/** One risk line per card, in one place and one style. It wraps rather than cut words off. */
export function RiskLine({ risk, text, className }: { risk: RiskClass; text: string; className?: string }) {
  const safe = risk === "read" || risk === "reversible";
  return (
    <span className={cx("flex min-w-0 items-start gap-1.5 text-caption font-medium", TONE[risk], className)}>
      {safe ? <CheckIcon className="shrink-0" /> : <AlertIcon className="shrink-0" />}
      <span className="min-w-0 break-words">{text}</span>
    </span>
  );
}
