import type { ReactNode } from "react";

/** A labelled form control with an optional hint below it. */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="animate-fade-in rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">
      {children}
    </p>
  );
}
