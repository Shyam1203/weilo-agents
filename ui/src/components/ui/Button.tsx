import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-page shadow-sm hover:opacity-90",
  secondary: "border border-line-strong bg-panel text-ink hover:bg-select",
  ghost: "text-ink-2 hover:bg-select hover:text-ink",
  danger: "border border-bad/40 text-bad hover:bg-bad-soft",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-[13px]",
  md: "h-9 gap-2 px-3.5 text-[13.5px]",
  lg: "h-11 gap-2 px-5 text-[14.5px]",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  busy?: boolean;
  children?: ReactNode;
}

export function Button({ variant = "secondary", size = "md", icon, busy = false, className = "", children, disabled, type = "button", ...rest }: Props) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      className={`inline-flex shrink-0 items-center justify-center rounded-xl font-medium whitespace-nowrap transition-[opacity,background-color,color] duration-150 disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {busy ? <Icon name="spinner" size={15} /> : icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, className = "", ...rest }: ComponentProps<"button"> & { icon: IconName; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-40 text-ink-2 hover:bg-select hover:text-ink ${className}`}
      {...rest}
    >
      <Icon name={icon} size={17} />
    </button>
  );
}
