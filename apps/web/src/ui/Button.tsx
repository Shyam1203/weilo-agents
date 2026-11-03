import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "../lib/format";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "danger" | "danger-solid";
export type ButtonSize = "sm" | "md" | "lg" | "phone";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover border-0",
  secondary: "bg-surface text-text border border-border ghost",
  tertiary: "bg-transparent text-text-secondary border-0 ghost",
  danger: "bg-surface text-danger border border-border ghost",
  // Only on the confirm step of a destructive action.
  "danger-solid": "bg-danger text-on-accent border-0 hover:opacity-90",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2 rounded-sm text-body-sm font-medium",
  md: "h-8 px-3 rounded-md text-body-sm font-medium",
  lg: "h-10 px-4 rounded-md text-body-sm font-medium",
  phone: "h-12 px-4 rounded-md text-phone font-medium",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});
