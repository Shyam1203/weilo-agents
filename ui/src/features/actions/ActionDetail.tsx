import { useState } from "react";
import { changeAction, type Action, type Every, type ScheduleInput } from "../../api/actions";
import { messageOf } from "../../api/http";
import { Button } from "../../components/ui/Button";
import { ErrorText, Field } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { Modal } from "../../components/ui/Modal";
import { Switch } from "../../components/ui/Switch";
import { longWhen, nextWhen } from "../../lib/format";

const OFTEN: { every: Every; label: string }[] = [
  { every: "once", label: "Once" },
  { every: "minutes", label: "Every few minutes" },
  { every: "hour", label: "Every hour" },
  { every: "day", label: "Every day" },
  { every: "weekday", label: "Weekdays" },
  { every: "week", label: "Every week" },
];
const MINUTES = [5, 10, 15, 30];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const today = () => new Date().toLocaleDateString("en-CA");

interface Props {
  action: Action;
  agentId: string;
  agentName: string;
  onRun: () => void;
  onChanged: (action: Action) => void;
  onRemove: () => Promise<void>;
  onClose: () => void;
}

/** One action: run it now, have it run by itself, ask first, what it did lately. Changes save as you make them. */
export function ActionDetail({ action, agentId, agentName, onRun, onChanged, onRemove, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(action.title);
  const [request, setRequest] = useState(action.request);
  const s = action.schedule;
  const draft: ScheduleInput = s ? { every: s.every, times: s.times, minutes: s.minutes, day: s.day, date: s.date } : { every: "day", times: ["08:00"] };
  const needsDefaults = action.fields.some((f) => !f.default);

  const save = (change: Parameters<typeof changeAction>[2]) => {
    setSaving(true);
    setError(null);
    changeAction(agentId, action.id, change)
      .then(onChanged, (err) => setError(messageOf(err)))
      .finally(() => setSaving(false));
  };
  const schedule = (patch: Partial<ScheduleInput>) => {
    const next = { ...draft, ...patch };
    if (next.every === "minutes") next.minutes ??= 10;
    if (next.every === "week") next.day ??= 1;
    if (next.every === "once") next.date ??= today();
    if (next.every !== "minutes" && !next.times?.length) next.times = ["08:00"];
    save({ schedule: next });
  };

  return (
    <Modal title={action.title} onClose={onClose} width="max-w-md">
      <div className="flex flex-col gap-4">
        {editing ? (
          <section className="flex flex-col gap-3">
            <Field label="Name">
              <input autoFocus value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} className="input" />
            </Field>
            {action.kind === "agent" ? (
              <Field label={`What should ${agentName} do?`}>
                <textarea value={request} rows={3} onChange={(e) => setRequest(e.target.value)} className="input resize-none" />
              </Field>
            ) : (
              <p className="text-[13px] text-ink-3">To change how it works, ask {agentName} in the chat.</p>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" onClick={() => (setEditing(false), setTitle(action.title), setRequest(action.request))}>Cancel</Button>
              <Button size="sm" variant="primary" disabled={saving || !title.trim() || (action.kind === "agent" && !request.trim())} onClick={() => (save(action.kind === "agent" ? { title, request } : { title }), setEditing(false))}>
                Save
              </Button>
            </div>
          </section>
        ) : (
          <div className="-mt-2 flex items-start justify-between gap-3">
            <p className="min-w-0 text-[13.5px] text-ink-2">{action.kind === "agent" ? action.request : action.about || "Instant"}</p>
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditing(true)} className="-mr-2 shrink-0">
              Edit
            </Button>
          </div>
        )}
        <Button variant="primary" size="lg" icon="play" onClick={onRun} className="w-full">
          Run now
        </Button>

        <section className="flex flex-col gap-3 rounded-xl p-3.5 ring-1 ring-line">
          <div className="flex items-center justify-between gap-3">
            <span className="flex flex-col">
              <span className="text-[14px] font-medium">Run by itself</span>
              <span className="text-xs text-ink-3">{needsDefaults ? "Needs its usual values first." : "At times you pick."}</span>
            </span>
            <Switch label="Run by itself" checked={!!s} onChange={(on) => (on ? schedule({}) : save({ schedule: null }))} />
          </div>
          {s && (
            <>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="How often">
                {OFTEN.map((o) => (
                  <button key={o.every} type="button" aria-pressed={s.every === o.every} disabled={saving} onClick={() => schedule({ every: o.every })} className={`h-8 rounded-full px-3 text-[13px] ring-1 transition-colors ${s.every === o.every ? "bg-ink text-page ring-ink" : "ring-line-strong hover:bg-select"}`}>
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                {s.every === "minutes" ? (
                  <label className="flex items-center gap-2">
                    Every
                    <select value={s.minutes} onChange={(e) => schedule({ minutes: Number(e.target.value) })} className="input w-auto py-1">
                      {MINUTES.map((m) => (
                        <option key={m} value={m}>
                          {m} minutes
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    {s.every === "week" && (
                      <select aria-label="Day" value={s.day} onChange={(e) => schedule({ day: Number(e.target.value) })} className="input w-auto py-1">
                        {DAYS.map((d, i) => (
                          <option key={d} value={i}>
                            {d}
                          </option>
                        ))}
                      </select>
                    )}
                    {s.every === "once" && <input aria-label="Date" type="date" min={today()} value={s.date} onChange={(e) => e.target.value && schedule({ date: e.target.value })} className="input w-auto py-1" />}
                    <label className="flex items-center gap-2">
                      At
                      <input type="time" value={s.times[0]} onChange={(e) => e.target.value && schedule({ times: [e.target.value] })} className="input w-auto py-1" />
                    </label>
                  </>
                )}
              </div>
              <span className="text-[13px] text-ink-2">{s.nextRunAt ? `Next: ${nextWhen(s.nextRunAt)}` : "No next time."}</span>
            </>
          )}
        </section>

        <ErrorText>{error}</ErrorText>

        {action.runs.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-ink-3">Recent</h3>
            <ul className="flex flex-col gap-1.5">
              {action.runs.slice(0, 5).map((r) => (
                <li key={r.at} className="flex items-start justify-between gap-3 text-[13px]">
                  <span className={`min-w-0 [overflow-wrap:anywhere] ${r.ok ? "" : "text-bad"}`}>
                    {r.by === "schedule" && <Icon name="clock" size={11} className="mr-1 inline align-[-0.05em] text-ink-3" />}
                    {r.text.split("\n")[0].replace(/^Failed: /, "Didn't work: ")}
                  </span>
                  <span className="shrink-0 text-xs text-ink-3">{longWhen(r.at / 1000)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex items-center justify-between gap-2">
          {removing ? (
            <span className="flex flex-1 items-center gap-2 text-[13px] text-ink-2">
              Delete "{action.title}"?
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => setRemoving(false)}>
                Keep
              </Button>
              <Button size="sm" variant="danger" onClick={() => void onRemove()}>
                Delete
              </Button>
            </span>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setRemoving(true)} className="-ml-2.5 text-bad">
                Delete action
              </Button>
              <Button onClick={onClose}>Done</Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
