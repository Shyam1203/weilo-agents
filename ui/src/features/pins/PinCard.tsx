import { useEffect, useRef } from "react";
import { describeSchedule, type Action } from "../../api/actions";
import type { Pin } from "../../api/pins";
import { Icon } from "../../components/ui/Icon";
import { Menu, MenuItem } from "../../components/ui/Menu";
import { shortWhen } from "../../lib/format";

interface Props {
  pin: Pin;
  lit?: boolean;
  action?: Action;
  onTick: (index: number, done: boolean) => void;
  onRemove: () => void;
  onOpenAction: (action: Action) => void;
}

function Trend({ points, tone }: { points: number[]; tone: Pin["tone"] }) {
  const low = Math.min(...points);
  const span = Math.max(...points) - low || 1;
  const line = points.map((p, i) => `${(i / (points.length - 1)) * 100},${30 - ((p - low) / span) * 26 - 2}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={`h-8 w-24 shrink-0 ${tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : "text-ink-3"}`} aria-hidden="true">
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function PinCard({ pin, lit, action, onTick, onRemove, onOpenAction }: Props) {
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (lit) card.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [lit]);
  const left = pin.items?.filter((i) => !i.done).length ?? 0;
  const tone = pin.tone === "good" ? "text-good" : pin.tone === "bad" ? "text-bad" : "text-ink-2";
  return (
    <article ref={card} aria-label={pin.title} className={`flex flex-col gap-2 rounded-xl px-3.5 py-3 transition-[box-shadow,background-color] duration-500 ${lit ? "bg-select ring-2 ring-ink" : "ring-1 ring-line"}`}>
      <header className="flex items-center gap-2">
        <Icon name={pin.icon} size={14} className="shrink-0 text-ink-2" />
        <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{pin.title}</h3>
        <span className="shrink-0 truncate text-xs text-ink-3">{pin.kind === "list" ? `${left} left` : pin.source || shortWhen(pin.updatedAt / 1000)}</span>
        <Menu trigger={({ toggle }) => <button type="button" aria-label={`More for ${pin.title}`} onClick={toggle} className="-mr-1.5 flex size-7 items-center justify-center rounded-lg text-ink-3 hover:bg-select"><Icon name="more" size={15} /></button>}>
          {(close) => <MenuItem icon="close" label="Remove pin" onClick={() => (close(), onRemove())} />}
        </Menu>
      </header>
      {pin.kind === "list" ? (
        <ul className="flex flex-col gap-1">
          {(pin.items ?? []).map((item, i) => (
            <li key={i}>
              <label className={`flex items-center gap-2.5 py-0.5 text-[13.5px] ${item.done ? "text-ink-3 line-through" : ""}`}>
                <input type="checkbox" checked={item.done} onChange={(e) => onTick(i, e.target.checked)} className="size-4 shrink-0 accent-ink" />
                {item.text}
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              {pin.value && <span className="truncate text-xl font-semibold tracking-tight">{pin.value}</span>}
              {pin.detail && <span className={`text-[12.5px] ${tone}`}>{pin.detail}</span>}
            </div>
            {pin.history.length > 1 && <Trend points={pin.history} tone={pin.tone} />}
          </div>
          {pin.steps && (
            <div role="img" aria-label={`Step ${pin.steps.done} of ${pin.steps.total}`} className="flex gap-1">
              {Array.from({ length: pin.steps.total }, (_, i) => (
                <span key={i} className={`h-1 flex-1 rounded-full ${i < pin.steps!.done ? "bg-good" : "bg-card"}`} />
              ))}
            </div>
          )}
        </>
      )}
      {action && (
        <button type="button" onClick={() => onOpenAction(action)} className="flex items-center gap-1 self-start text-xs text-ink-2 hover:text-ink">
          <Icon name="clock" size={11} />
          {action.schedule ? `Checks ${describeSchedule(action.schedule).replace(/^(Every|Weekdays|Once)/, (w) => w.toLowerCase())}` : action.title}
          <Icon name="chevronRight" size={11} />
        </button>
      )}
    </article>
  );
}
