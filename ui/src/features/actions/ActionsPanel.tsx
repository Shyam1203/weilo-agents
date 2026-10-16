import { describeSchedule, lastRun, type Action } from "../../api/actions";
import { Button, IconButton } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { Loading } from "../../components/ui/List";
import { inHowLong, shortWhen } from "../../lib/format";

interface Props {
  agentName: string;
  off: boolean;
  actions: Action[] | null;
  error: string | null;
  running: Set<string>;
  onRun: (action: Action) => void;
  onOpen: (action: Action) => void;
  onNew: () => void;
  /** Leave out the heading where the panel has one already (a sheet on a phone). */
  titled?: boolean;
}

/** Things the agent does for you: with a tap, and by itself at the times you choose. */
export function ActionsPanel({ agentName, off, actions, error, running, onRun, onOpen, onNew, titled = true }: Props) {
  return (
    <section className="flex flex-col gap-3 p-4">
      {titled && (
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-medium text-ink-2">Actions</h2>
          {!off && <IconButton icon="plus" label="New action" onClick={onNew} />}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      {off ? (
        <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] leading-relaxed text-ink-3">Actions are turned off for this agent.</p>
      ) : actions === null ? (
        !error && <Loading />
      ) : (
        <>
          {actions.length > 0 && (
            <ul className="flex flex-col overflow-hidden rounded-xl ring-1 ring-line">
              {actions.map((a) => {
                const last = lastRun(a);
                const waiting = a.runs[0]?.waiting;
                const busy = running.has(a.id);
                return (
                  <li key={a.id} className={`flex items-center gap-2.5 border-b border-line px-3 py-2.5 last:border-b-0 ${busy ? "bg-panel" : ""}`}>
                    <button type="button" onClick={() => onOpen(a)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-card text-ink-2">
                        <Icon name={a.icon} size={16} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[13.5px] font-medium">{a.title}</span>
                          {a.kind === "script" && <span className="shrink-0 rounded-md bg-card px-1.5 text-[11px] text-ink-2">Instant</span>}
                        </span>
                        <span className={`truncate text-xs ${waiting ? "font-medium text-ink" : last && !last.ok ? "text-bad" : "text-ink-3"}`} title={last?.text ?? a.about}>
                          {busy ? "Working on it…" : waiting ? "Ready to run: it asks you first" : last ? `${last.text.split("\n")[0].replace(/^Failed: /, "Didn't work: ")} · ${shortWhen(last.at / 1000)}` : a.confirm ? "Asks you first" : a.about || "Not run yet"}
                        </span>
                        {a.schedule && (
                          <span className="flex items-center gap-1 truncate text-xs text-ink-2">
                            <Icon name="clock" size={11} className="shrink-0" />
                            {describeSchedule(a.schedule)}
                            {a.schedule.nextRunAt && inHowLong(a.schedule.nextRunAt) ? ` · next ${inHowLong(a.schedule.nextRunAt)}` : ""}
                          </span>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Run ${a.title} now`}
                      title={`Run ${a.title} now`}
                      disabled={busy}
                      onClick={() => onRun(a)}
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink text-page transition-opacity hover:opacity-85 disabled:opacity-50"
                    >
                      <Icon name={busy ? "spinner" : "play"} size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {actions.length > 0 ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-ink-3">Tap a name to edit.</p>
              {!titled && (
                <Button size="sm" icon="plus" onClick={onNew}>
                  New action
                </Button>
              )}
            </div>
          ) : (
            <button type="button" onClick={onNew} className="rounded-2xl border border-dashed border-line-strong px-4 py-5 text-center text-[13px] text-ink-3 hover:bg-select">
              No actions yet. <span className="font-medium text-ink">+ New action</span>
            </button>
          )}
        </>
      )}
    </section>
  );
}
