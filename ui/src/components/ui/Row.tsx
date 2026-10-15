import type { ReactNode } from "react";
import { IconTile } from "./Tag";
import type { IconName } from "./Icon";

export const Card = ({ children }: { children: ReactNode }) => <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">{children}</ul>;

export function Row({ icon, tile, title, description, children, below }: { icon?: IconName; tile?: ReactNode; title: ReactNode; description?: ReactNode; children?: ReactNode; below?: ReactNode }) {
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

export function Page({ title, description, action, section, children }: { title: string; description?: ReactNode; action?: ReactNode; section?: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className={`flex items-start gap-3 ${description || action || section ? "" : "max-md:hidden"}`}>
        <div className="min-w-0 flex-1">
          <h3 className={`text-[15px] font-semibold tracking-tight ${section ? "" : "max-md:hidden"}`}>{title}</h3>
          {description && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
