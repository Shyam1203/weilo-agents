import { useEffect, useRef } from "react";
import { loadEngines } from "../../lib/app";
import { canPick, pickOrder, statusLine } from "../../lib/engines";
import { cx, engineTitle } from "../../lib/format";
import { useApp } from "../../lib/store";
import type { EngineInfo } from "../../proto/EngineInfo";
import { TextWithCode } from "../../ui/bits";

/** The engine list, asked for once when something needs it. */
export function useEngineList(when = true): EngineInfo[] | null {
  const engines = useApp((s) => s.engines);
  useEffect(() => {
    if (when && !engines) loadEngines().catch(() => {});
  }, [when, engines]);
  return engines;
}

/**
 * Which AI an agent or session uses: one row per engine with its status line. Engines
 * that can't be picked yet stay in the list, greyed, and their line (and how to fix it)
 * says why.
 */
export function EnginePicker({
  label,
  engines,
  value,
  onChange,
}: {
  label: string;
  engines: EngineInfo[] | null;
  value: string;
  onChange(id: string): void;
}) {
  const group = useRef<HTMLDivElement>(null);
  if (!engines) return <p className="m-0 text-body-sm text-text-secondary">Looking for AI apps…</p>;
  const list = pickOrder(engines);
  const pickable = list.filter(canPick);
  const move = (from: string, step: number) => {
    const i = pickable.findIndex((e) => e.id === from);
    const next = pickable[(i + step + pickable.length) % pickable.length];
    if (!next) return;
    onChange(next.id);
    group.current?.querySelector<HTMLElement>(`[data-engine="${CSS.escape(next.id)}"]`)?.focus();
  };
  return (
    <div ref={group} role="radiogroup" aria-label={label} className="flex flex-col overflow-hidden rounded-md border border-border">
      {list.map((e, i) => {
        const ok = canPick(e);
        const on = ok && e.id === value;
        return (
          <button
            key={e.id}
            type="button"
            role="radio"
            data-engine={e.id}
            aria-checked={on}
            aria-disabled={!ok}
            tabIndex={on || (!value && e === pickable[0]) ? 0 : -1}
            onClick={() => ok && onChange(e.id)}
            onKeyDown={(ev) => {
              if (ev.key === "ArrowDown" || ev.key === "ArrowRight") {
                ev.preventDefault();
                move(e.id, 1);
              } else if (ev.key === "ArrowUp" || ev.key === "ArrowLeft") {
                ev.preventDefault();
                move(e.id, -1);
              }
            }}
            className={cx(
              "flex min-h-12 w-full items-start gap-3 border-0 px-3 py-2 text-left whitespace-normal max-md:min-h-14",
              i < list.length - 1 && "shadow-line",
              on ? "bg-accent-subtle" : "bg-surface",
              ok ? "ghost" : "cursor-default",
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                on ? "border-accent" : "border-border-strong",
                !ok && "opacity-50",
              )}
            >
              {on && <span className="size-2 rounded-full bg-accent" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cx("text-body-sm font-medium", on ? "text-accent-text" : ok ? "text-text" : "text-text-secondary")}>
                {engineTitle(e.id, [e])}
              </span>
              <span className="text-caption text-text-secondary">
                <TextWithCode text={statusLine(e)} />
                {!ok && e.how ? (
                  <>
                    {" "}
                    <TextWithCode text={e.how} />
                  </>
                ) : null}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
