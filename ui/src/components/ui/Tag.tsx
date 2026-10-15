import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export const Tag = ({ children }: { children: ReactNode }) => <span className="shrink-0 rounded-md bg-select px-2 py-0.5 text-[11px] font-medium text-ink-3">{children}</span>;

export const IconTile = ({ icon }: { icon: IconName }) => (
  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-ink-2">
    <Icon name={icon} size={15} />
  </span>
);

export const LetterTile = ({ name }: { name: string }) => (
  <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-card text-[13px] font-semibold text-ink-2">
    {name.trim().charAt(0).toUpperCase()}
  </span>
);
