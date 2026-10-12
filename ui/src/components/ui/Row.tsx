// Settings-style rows: a bordered card of rows, each with a title and a short description on the
// left and its control on the right; and a page heading to put above them.
import type { ReactNode } from "react";
import { IconTile } from "./Tag";
import type { IconName } from "./Icon";

/** The card that holds rows. */
export const Card = ({ children }: { children: ReactNode }) => <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">{children}</ul>;

/** One row. `children` is its control (a button, a switch, a tag); `below` is a form or list that opens under it.
 *  A control marked with the class `pick` (a dropdown) takes the full width on a phone. */
export function Row({ icon, tile, title, description, children, below }: { icon?: IconName; /** Shown instead of an icon. */ tile?: ReactNode; title: ReactNode; description?: ReactNode; children?: ReactNode; below?: ReactNode }) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {tile ?? (icon && <IconTile icon={icon} />)}
        <div className="min-w-[10rem] flex-1">
          <p className="truncate text-[13.5px] font-medium">{title}</p>
          {description && <p className="text-xs leading-relaxed text-ink-3 [overflow-wrap:anywhere]">{description}</p>}
        </div>
        {children && <div className="ml-auto flex shrink-0 items-center gap-2 max-sm:has-[.pick]:min-w-0 max-sm:has-[.pick]:basis-full">{children}</div>}
      </div>
      {below && <div className="mt-3">{below}</div>}
    </li>
  );
}

/** A page of Settings: its heading, what it is for, and an action at the right. */
export function Page({ title, description, action, children }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
