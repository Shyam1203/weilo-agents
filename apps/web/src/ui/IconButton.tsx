import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "../lib/format";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Every icon button says what it does. */
  label: string;
  size?: 24 | 28 | 32 | 44;
  children: ReactNode;
}

const SIZES = { 24: "size-6 rounded-sm", 28: "size-7 rounded-sm", 32: "size-8 rounded-md", 44: "size-11 rounded-md" };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 32, className, children, type = "button", title, ...rest },
  ref,
) {
  // A caller's own background (e.g. bg-bg over a label) wins over the default.
  const ownBg = /(^|\s)bg-/.test(className ?? "");
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={cx(
        "ghost inline-flex shrink-0 items-center justify-center border-0 p-0 text-text-secondary transition-colors disabled:opacity-50",
        !ownBg && "bg-transparent",
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
