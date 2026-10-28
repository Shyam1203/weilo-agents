import { useState } from "react";
import { decide, setComposerDraft } from "../../lib/app";
import { cx, timeOf } from "../../lib/format";
import { isSmall } from "../../lib/needsYou";
import { useApp } from "../../lib/store";
import { outcomeWords, type Decided } from "../../lib/timeline";
import type { Card as CardData } from "../../proto/Card";
import type { CardAction } from "../../proto/CardAction";
import { Button, type ButtonVariant } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { CheckIcon, ChevronDownIcon, MailIcon, XCircleIcon } from "../../ui/glyphs";
import { RiskLine } from "../../ui/RiskLine";
import { focusComposer, useVariant } from "./useThread";

export interface EventCardProps {
  card: CardData;
  decided: Decided | null;
  threadId: string;
  /** "Show the command" in sessions, "Show details" elsewhere. */
  detailsLabel?: string;
}

function variantOf(a: CardAction): ButtonVariant {
  if (a.primary) return "primary";
  if (a.decision?.kind === "deny") return "tertiary";
  return "secondary";
}

/** Needs a confirm step: a yes that can't be taken back. */
function needsConfirm(card: CardData, a: CardAction): boolean {
  return !isSmall(card.risk) && (a.decision?.kind === "allow" || a.decision?.kind === "allow_always");
}

/** Draft and approval cards: title, optional body, details behind a disclosure, one risk line, one primary. */
export function EventCard({ card, decided, threadId, detailsLabel = "Show details" }: EventCardProps) {
  const phone = useVariant() === "phone";
  const itemState = useApp((s) =>
    card.approval_id ? s.snapshot?.needs_you.find((n) => n.approval_id === card.approval_id)?.state : undefined,
  );
  const [confirming, setConfirming] = useState<CardAction | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = card.kind === "draft";

  const act = async (a: CardAction) => {
    if (!a.decision) {
      setComposerDraft(threadId, draft ? "Change the draft: " : `${a.label}: `);
      focusComposer();
      return;
    }
    if (!card.approval_id) return;
    if (!confirming && needsConfirm(card, a)) {
      setConfirming(a);
      return;
    }
    setBusy(true);
    await decide(card.approval_id, a.decision);
    setBusy(false);
    setConfirming(null);
  };

  // Closed because the session or agent was stopped (by the host, or here before it says so).
  const stoppedHere = useApp((s) => !!card.approval_id && !!s.stoppedCards[card.approval_id]);
  const outcome = decided
    ? decided.via === "stopped" || decided.via === "interrupted"
      ? { text: "Stopped", at: decided.at, yes: false }
      : { text: outcomeWords(decided.decision, card.kind, card.actions), at: decided.at, yes: decided.decision.kind !== "deny" }
    : stoppedHere
      ? { text: "Stopped", at: null, yes: false }
    : itemState === "allowed"
      ? { text: outcomeWords({ kind: "allow" }, card.kind), at: null, yes: true }
      : itemState === "denied"
        ? { text: outcomeWords({ kind: "deny" }, card.kind), at: null, yes: false }
        : itemState === "expired"
          ? { text: "Expired before you answered", at: null, yes: false }
          : null;

  const [titleText, ...meta] = draft ? card.title.split(" · ") : [card.title];
  const [subject, ...rest] = draft && card.body ? card.body.split("\n") : [];

  const details = card.details && (
    <details className="group text-body-sm text-text-secondary">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm font-medium hover:text-text [&::-webkit-details-marker]:hidden">
        <ChevronDownIcon size={12} className="shrink-0 -rotate-90 transition-transform duration-[120ms] group-open:rotate-0" />
        {detailsLabel}
      </summary>
      <pre className="m-0 mt-2 overflow-x-auto rounded-sm border border-border bg-surface px-2 py-1.5 font-mono text-body-sm whitespace-pre-wrap text-text">
        {card.details}
      </pre>
    </details>
  );

  const footer = (
    <CardFooter
      card={card}
      outcome={outcome}
      confirming={confirming}
      busy={busy}
      phone={phone}
      onAct={act}
      onBack={() => setConfirming(null)}
    />
  );

  if (draft) {
    return (
      <Card phone={phone} aria-label={titleText}>
        <div className="flex min-h-11 items-center gap-2 border-b border-border px-4 py-2">
          <MailIcon className="shrink-0 text-text-secondary" />
          <span className="flex-1 text-title-sm font-semibold">{titleText}</span>
          {meta.length > 0 && <span className="ellipsis text-caption text-text-secondary">{meta.join(" · ")}</span>}
        </div>
        <div className="flex flex-col gap-1 p-4">
          {subject && <div className="text-title-sm font-semibold">{subject}</div>}
          {rest.length > 0 && <div className="whitespace-pre-wrap text-text-secondary">{rest.join("\n")}</div>}
          {details && <div className="pt-2">{details}</div>}
        </div>
        <div className="border-t border-border px-4 py-3">{footer}</div>
      </Card>
    );
  }

  return (
    <Card phone={phone} aria-label={card.kind === "question" ? "Question" : "Approval"} className="flex flex-col gap-3 p-4">
      <div className="text-title-sm font-semibold">{card.title}</div>
      {card.body && <div className="whitespace-pre-wrap text-text-secondary">{card.body}</div>}
      {details}
      {footer}
    </Card>
  );
}

function CardFooter({
  card,
  outcome,
  confirming,
  busy,
  phone,
  onAct,
  onBack,
}: {
  card: CardData;
  outcome: { text: string; at: string | null; yes: boolean } | null;
  confirming: CardAction | null;
  busy: boolean;
  phone: boolean;
  onAct(a: CardAction): void;
  onBack(): void;
}) {
  const size = phone ? "phone" : "md";
  if (outcome) {
    return (
      <div className="flex items-center gap-1.5 text-caption font-medium text-text-secondary" role="status">
        {outcome.yes ? <CheckIcon className="text-success" /> : <XCircleIcon />}
        <span>
          {outcome.text}
          {outcome.at ? ` · ${timeOf(outcome.at)}` : ""}
        </span>
      </div>
    );
  }
  if (confirming) {
    const destructive = card.risk === "destructive";
    return (
      <div className={cx("flex gap-2", phone ? "flex-col" : "items-center")} role="group" aria-label="Confirm">
        <span className="min-w-0 flex-1 text-body-sm">
          <b className="font-semibold">{confirming.label}?</b>{" "}
          <span className="text-text-secondary">{card.risk_line}.</span>
        </span>
        <div className="flex gap-2">
          <Button size={size} variant="tertiary" onClick={onBack} disabled={busy} className={cx(phone && "flex-1")}>
            Back
          </Button>
          <Button
            size={size}
            variant={destructive ? "danger-solid" : "primary"}
            onClick={() => onAct(confirming)}
            disabled={busy}
            autoFocus
            className={cx(phone && "flex-1")}
          >
            {confirming.label}
          </Button>
        </div>
      </div>
    );
  }
  // Phones: the primary first and full width, then the secondary, then "Not now" as a text button.
  const actions = phone ? [...card.actions].sort((a, b) => RANK[variantOf(a)] - RANK[variantOf(b)]) : card.actions;
  return (
    <div className={cx("flex gap-2", phone ? "flex-col items-stretch" : "flex-wrap items-center")}>
      <RiskLine risk={card.risk} text={card.risk_line} className="flex-1" />
      {actions.length > 0 && (
        <div className={cx("flex gap-2", phone && "flex-col")}>
          {actions.map((a) => (
            <Button
              key={a.id}
              size={size}
              variant={variantOf(a)}
              disabled={busy}
              onClick={() => onAct(a)}
              className={cx(phone && "w-full")}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

const RANK: Record<ButtonVariant, number> = { primary: 0, secondary: 1, danger: 1, "danger-solid": 1, tertiary: 2 };
