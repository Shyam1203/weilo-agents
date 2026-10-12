// How full the agent's context is, beside the send button: a number and a small bar (a ring looked like a loading
// spinner). Hover or tap it for the tokens, where pi
// summarizes, and a button to summarize now.
import { useCallback, useState } from "react";
import type { Context } from "../../api/chat";
import { useDismiss } from "../../lib/useDismiss";

interface Props {
  context: Context;
  /** A summary is being made. */
  compacting: boolean;
  /** A run is going: a summary has to wait for it. */
  busy: boolean;
  onCompact: () => void;
}

// 188100 -> "188.1k", 1048576 -> "1.05M".
const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(n));

export function ContextMeter({ context, compacting, busy, onCompact }: Props) {
  const { tokens, window, point } = context;
  const used = tokens === null ? 0 : Math.min(tokens / window, 1);
  // Red as the context nears the point where pi summarizes.
  const fill = tokens === null ? 0 : Math.min(tokens / point, 1);
  const tight = fill >= 0.8;
  // Hovering shows the details on a computer; a tap (a touch screen has no hover, and Safari does not focus a tapped
  // button) or a click keeps them open until a tap outside.
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);
  return (
    <div ref={ref} className="group relative flex h-9 shrink-0 items-center justify-center">
      <button type="button" aria-label={tokens === null ? "Context use" : `Context ${Math.round(used * 100)}% used`} aria-expanded={open} onClick={() => setOpen((v) => !v)} className={`flex h-9 items-center gap-1 rounded-lg px-1.5 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-line-strong ${tight ? "text-bad" : "text-ink-3"}`}>
        <span className={`relative h-1.5 w-4 overflow-hidden rounded-full bg-line-strong ${compacting ? "animate-pulse" : ""}`} aria-hidden>
          <span className={`absolute inset-y-0 left-0 rounded-full ${tight ? "bg-bad" : "bg-ink-3"}`} style={{ width: `${Math.max(used * 100, 8)}%` }} />
        </span>
        {tokens === null ? "–" : `${Math.round(used * 100)}%`}
      </button>
      <div className={`absolute right-0 bottom-full z-30 pb-2 transition-opacity group-hover:visible group-hover:opacity-100 ${open ? "visible opacity-100" : "invisible opacity-0"}`}>
        <div className="flex w-52 flex-col gap-1.5 rounded-xl bg-raised px-3 py-2.5 text-xs shadow-pop">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-ink">Context</span>
            <span className="text-ink-2">{compacting ? "Summarizing…" : tokens === null ? `after next reply / ${short(window)}` : `${short(tokens)} / ${short(window)} (${Math.round(used * 100)}%)`}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-ink-3">
            <span>Auto-compact</span>
            <span className="text-ink-2">{Math.round((point / window) * 100)}%</span>
          </div>
          <button type="button" disabled={busy || compacting || tokens === null} onClick={() => (close(), onCompact())} className="self-end font-medium text-ink-2 transition-colors hover:text-ink disabled:opacity-50">
            Compact now
          </button>
        </div>
      </div>
    </div>
  );
}
