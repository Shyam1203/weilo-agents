import type { ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";

export type Fix = "retry" | "model" | "providers" | "limit";

/** What the user can do about a failed message or reply, read from its error. */
export function fixesFor(message: string, status?: number): Fix[] {
  if (status === 429 && /today|daily/i.test(message)) return ["limit"];
  if (/tokens for today|daily limit/i.test(message)) return ["limit"];
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid.{0,24}key|authenticat|credential|expired|sign in/i.test(message)) return ["providers", "retry"];
  if (/model.{0,40}(not found|does not exist|not supported|unavailable|deprecated)|\b404\b/i.test(message)) return ["model"];
  return ["retry", "model"];
}

interface Props {
  message: ReactNode;
  fixes: Fix[];
  tone?: "alert" | "info";
  onRetry?: () => void;
  /** The control that changes the model, already set up as a button. */
  changeModel: ReactNode;
  onProviders: () => void;
  onLimit: () => void;
}

/** A problem in the chat, with buttons for what can fix it. */
export function Problem({ message, fixes, tone = "alert", onRetry, changeModel, onProviders, onLimit }: Props) {
  return (
    <div role={tone === "alert" ? "alert" : "status"} className="flex gap-2.5 rounded-xl bg-card px-3.5 py-3 text-[13px] text-ink-2 ring-1 ring-line ring-inset">
      <Icon name={tone === "alert" ? "alert" : "info"} size={15} className={`mt-0.5 shrink-0 ${tone === "alert" ? "text-bad" : "text-ink-3"}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="leading-relaxed [overflow-wrap:anywhere]">{message}</div>
        {fixes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {fixes.map((fix) =>
              fix === "retry" ? (
                onRetry && (
                  <Button key={fix} size="sm" icon="retry" onClick={onRetry}>
                    Try again
                  </Button>
                )
              ) : fix === "model" ? (
                <span key={fix}>{changeModel}</span>
              ) : fix === "providers" ? (
                <Button key={fix} size="sm" icon="key" onClick={onProviders}>
                  Open Providers
                </Button>
              ) : (
                <Button key={fix} size="sm" icon="settings" onClick={onLimit}>
                  Raise limit
                </Button>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
