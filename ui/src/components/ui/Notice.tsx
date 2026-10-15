import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function Notice({ tone = "info", title, children, action }: { tone?: "info" | "alert"; title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role={tone === "alert" ? "alert" : "status"} className="flex items-center gap-2.5 rounded-xl bg-card px-3.5 py-3 text-[13px] text-ink-2 ring-1 ring-line ring-inset">
      <Icon name={tone === "alert" ? "alert" : "info"} size={15} className={`shrink-0 ${tone === "alert" ? "text-bad" : "text-ink-3"}`} />
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <span className="font-medium text-ink">{title} </span>}
        {children}
      </div>
      {action}
    </div>
  );
}
