import { useCallback, useEffect, useState } from "react";
import { describeSchedule, listRoutines, type Routine } from "../../api/routines";
import { IconButton } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { Loading } from "../../components/ui/List";
import { aheadOf, inHowLong, nextWhen } from "../../lib/format";
import { RoutineForm } from "./RoutineForm";

const POLL_MS = 15_000;

function sections(routines: Routine[]) {
  const groups = new Map<string, Routine[]>();
  for (const r of routines) {
    const label = r.nextRunAt ? aheadOf(r.nextRunAt) : "Did not run";
    groups.set(label, [...(groups.get(label) ?? []), r]);
  }
  return [...groups];
}

interface Props {
  agentId: string;
  agentName: string;
  off: boolean;
  changed: number;
}

export function RoutinesPanel({ agentId, agentName, off, changed }: Props) {
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Routine | null | undefined>(undefined);

  const refresh = useCallback(() => listRoutines(agentId).then((list) => (setRoutines(list), setError(null)), (err) => setError(err.message)), [agentId]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => document.visibilityState === "visible" && void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, changed]);

  return (
    <section className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-ink-2">Routines</h2>
        {!off && <IconButton icon="plus" label="New routine" onClick={() => setForm(null)} />}
      </div>
      <ErrorText>{error}</ErrorText>
      {off && <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] leading-relaxed text-ink-3">Routines are turned off for this agent.{routines?.length ? " The ones already set still run." : ""}</p>}
      {routines === null ? (
        !error && !off && <Loading />
      ) : routines.length === 0 ? (
        off ? null :
        <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] leading-relaxed text-ink-3">No routines yet. Ask {agentName} to do a task every morning, or add one here.</p>
      ) : (
        sections(routines).map(([label, list]) => (
          <div key={label} className="flex flex-col gap-2">
            <h3 className="mt-1 text-xs font-medium text-ink-3">{label}</h3>
            <ul className="flex flex-col gap-2">
              {list.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setForm(r)} className="flex w-full flex-col gap-1 rounded-xl bg-panel px-3 py-2.5 text-left ring-1 ring-line transition-colors hover:ring-line-strong">
                    <span className="flex items-start gap-2">
                      <Icon name="clock" size={14} className="mt-[3px] shrink-0 text-ink-3" />
                      <span className="min-w-0 flex-1 line-clamp-2 text-[13.5px] font-medium">{r.title}</span>
                      {r.nextRunAt && <Countdown at={r.nextRunAt} />}
                    </span>
                    <span className="text-xs leading-relaxed text-ink-2">{describeSchedule(r)}</span>
                    {r.lastError ? <span className="text-xs text-bad">{r.nextRunAt && !r.lastError.startsWith("Missed") ? `Last run failed: ${r.lastError}` : r.lastError}</span> : r.nextRunAt && <span className="text-xs text-ink-3">Next: {nextWhen(r.nextRunAt)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      {form !== undefined && <RoutineForm agentId={agentId} agentName={agentName} routine={form} onClose={() => setForm(undefined)} onDone={() => (setForm(undefined), void refresh())} />}
    </section>
  );
}

function Countdown({ at }: { at: number }) {
  const text = inHowLong(at);
  return text && <span className={`mt-px shrink-0 text-xs font-medium ${at - Date.now() < 3_600_000 ? "text-working" : "text-ink-3"}`}>{text}</span>;
}
