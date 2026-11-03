import type { ReactNode } from "react";
import { cx } from "../../lib/format";
import { TopBar } from "../../ui/bits";
import { ConnectionBanner } from "./Toast";

/** A plain page: a 56px title bar and a column of content. */
export function PageFrame({
  title,
  children,
  phone,
  actions,
}: {
  title: string;
  children: ReactNode;
  phone?: boolean;
  /** Buttons at the right of the title bar (the "+" on Channels and Agents). */
  actions?: ReactNode;
}) {
  return (
    <main className={cx("flex min-h-0 min-w-0 flex-1 flex-col", phone ? "bg-bg" : "bg-surface")}>
      <TopBar className={phone ? "px-4" : "px-6"}>
        <h1 className={cx("m-0 flex-1 font-semibold", phone ? "text-title" : "text-title-sm")}>{title}</h1>
        {actions}
      </TopBar>
      <ConnectionBanner />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cx("flex w-full max-w-[768px] flex-col gap-6", phone ? "p-4" : "p-6")}>{children}</div>
      </div>
    </main>
  );
}

