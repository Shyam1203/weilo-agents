import { useRef, useState } from "react";
import { decide } from "../../lib/app";
import { isSmall, yesAction } from "../../lib/needsYou";
import { navigate, paths, threadPath } from "../../lib/router";
import { pendingNeedsYou, useApp } from "../../lib/store";
import type { NeedsYouItem } from "../../proto/NeedsYouItem";
import { Button } from "../../ui/Button";
import { Link } from "../../ui/Link";
import { RiskLine } from "../../ui/RiskLine";

/** "Needs you · 1 of 2": cards you swipe through. For anything you can't take back, Look first is the primary. */
export function NeedsYouStack() {
  const items = useApp(pendingNeedsYou);
  const [index, setIndex] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  if (items.length === 0) return null;
  const shown = Math.min(index, items.length - 1);

  return (
    <section aria-label="Needs you" aria-roledescription="carousel" className="flex shrink-0 flex-col gap-2 px-4 pt-2 pb-4">
      <div className="flex items-center text-caption font-medium">
        <span className="flex-1 text-warning" aria-live="polite">
          Needs you · {shown + 1} of {items.length}
        </span>
        <Link href={paths.needs()} className="flex h-11 items-center px-1 text-caption font-medium">
          See all
        </Link>
      </div>
      <div
        ref={strip}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4"
      >
        {items.map((item, i) => (
          <StackCard key={item.approval_id} item={item} n={i + 1} total={items.length} />
        ))}
      </div>
    </section>
  );
}

function StackCard({ item, n, total }: { item: NeedsYouItem; n: number; total: number }) {
  const snap = useApp((s) => s.snapshot)!;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const yes = yesAction(item.card.actions);
  const small = isSmall(item.card.risk);
  const thread = snap.threads.find((t) => t.id === item.thread_id);
  const open = () => navigate(thread ? threadPath(thread) : paths.home());
  const approve = async () => {
    if (!yes?.decision) return;
    setBusy(true);
    await decide(item.approval_id, yes.decision);
    setBusy(false);
  };

  return (
    <article
      aria-roledescription="slide"
      aria-label={`${n} of ${total}: ${item.card.title}`}
      className="flex w-full shrink-0 snap-center flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-e1"
    >
      <div className="ellipsis text-caption text-text-tertiary">{item.source}</div>
      <div className="text-title-sm font-semibold">{item.card.title}</div>
      {confirming ? (
        <div className="text-body-sm text-text-secondary">
          <b className="font-semibold text-text">{yes?.label}?</b> {item.card.risk_line}.
        </div>
      ) : (
        <RiskLine risk={item.card.risk} text={item.card.risk_line} />
      )}
      <div className="flex gap-2 pt-1">
        {confirming ? (
          <>
            <Button size="phone" variant="tertiary" className="flex-1" onClick={() => setConfirming(false)}>
              Back
            </Button>
            <Button
              size="phone"
              variant={item.card.risk === "destructive" ? "danger-solid" : "primary"}
              className="flex-1"
              disabled={busy}
              onClick={() => void approve()}
            >
              {yes?.label}
            </Button>
          </>
        ) : small ? (
          <>
            <Button size="phone" className="flex-1" onClick={open}>
              Open
            </Button>
            {yes && (
              <Button size="phone" variant="primary" className="flex-1" disabled={busy} onClick={() => void approve()}>
                {yes.label}
              </Button>
            )}
          </>
        ) : (
          <>
            {yes && (
              <Button size="phone" className="ellipsis flex-1" onClick={() => setConfirming(true)}>
                {yes.label.split(" ")[0]}
              </Button>
            )}
            <Button size="phone" variant="primary" className="flex-1" onClick={open}>
              Look first
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
