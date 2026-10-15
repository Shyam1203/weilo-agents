import { useEffect, useState, type FormEvent } from "react";
import { addRoutine, clock, DAY_NAMES, removeRoutine, updateRoutine, type Every, type Routine } from "../../api/routines";
import { Button, IconButton } from "../../components/ui/Button";
import { Choice } from "../../components/ui/Choice";
import { ErrorText, Field } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { MAX_ROUTINE_TASK, MAX_ROUTINE_TITLE, MAX_TIMES } from "../../lib/limits";
import { useAction } from "../../lib/useAction";

const EVERY: { value: Every; label: string }[] = [
  { value: "once", label: "Once" },
  { value: "hour", label: "Hourly" },
  { value: "day", label: "Daily" },
  { value: "weekday", label: "Weekdays" },
  { value: "week", label: "Weekly" },
];

const dayOf = (plusDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + plusDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const timesLeft = () => {
  const next = Math.ceil((Date.now() + 60_000) / 300_000) * 300_000;
  const left: string[] = [];
  for (let at = next; new Date(at).getDate() === new Date().getDate(); at += 300_000) left.push(new Date(at).toTimeString().slice(0, 5));
  return left;
};

const MINUTES = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

interface Props {
  agentId: string;
  agentName: string;
  routine: Routine | null;
  onClose: () => void;
  onDone: () => void;
}

export function RoutineForm({ agentId, agentName, routine, onClose, onDone }: Props) {
  const { busy, error, run } = useAction();
  const [title, setTitle] = useState(routine?.title ?? "");
  const [task, setTask] = useState(routine?.task ?? "");
  const [every, setEvery] = useState<Every>(routine?.every ?? "weekday");
  const [times, setTimes] = useState(routine?.times ?? ["08:00"]);
  const [date, setDate] = useState(routine?.date ?? dayOf(1));
  const [day, setDay] = useState(routine?.day ?? 1);

  const today = every === "once" && date === dayOf();
  const left = today ? timesLeft() : [];
  useEffect(() => {
    if (today && left.length && !left.includes(times[0])) setTimes([left[0]]);
  }, [today, times[0]]);

  const past = every === "once" && !!date && new Date(`${date}T${times[0]}`).getTime() <= Date.now();

  const save = (event: FormEvent) => {
    event.preventDefault();
    const one = every === "hour" ? [`00:${times[0].slice(3)}`] : [times[0]];
    const input = { title, task, every, times: every === "hour" || every === "once" ? one : times, ...(every === "week" && { day }), ...(every === "once" && { date }) };
    void run("save", async () => (await (routine ? updateRoutine(agentId, routine.id, input) : addRoutine(agentId, input)), onDone()));
  };
  const remove = () => run("delete", async () => (await removeRoutine(agentId, routine!.id), onDone()));

  return (
    <Modal title={routine ? "Edit routine" : "New routine"} onClose={onClose} width="max-w-md">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Name">
          <input autoFocus value={title} maxLength={MAX_ROUTINE_TITLE} onChange={(e) => setTitle(e.target.value)} placeholder="Morning brief" className="input" />
        </Field>
        <Field label="What to do">
          <textarea value={task} rows={4} maxLength={MAX_ROUTINE_TASK} onChange={(e) => setTask(e.target.value)} placeholder={`Tell ${agentName} what to do each time.`} className="input resize-y leading-relaxed" />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="label">How often</span>
          <Choice label="How often" value={every} onChange={setEvery} options={EVERY} row />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {every === "once" && (
            <Field label="Date">
              <input type="date" value={date} min={dayOf()} onChange={(e) => setDate(e.target.value)} className="input" />
            </Field>
          )}
          {every === "week" && (
            <Field label="Day">
              <select value={day} onChange={(e) => setDay(Number(e.target.value))} className="input">
                {DAY_NAMES.map((name, i) => (
                  <option key={name} value={i}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="label">{times.length > 1 && every !== "hour" && every !== "once" ? "Times" : "Time"}</span>
            {every === "hour" ? (
              <select aria-label="Minute" value={times[0].slice(3)} onChange={(e) => setTimes([`00:${e.target.value}`])} className="input">
                {(MINUTES.includes(times[0].slice(3)) ? MINUTES : [...MINUTES, times[0].slice(3)].sort()).map((m) => (
                  <option key={m} value={m}>
                    :{m} past the hour
                  </option>
                ))}
              </select>
            ) : (
              today && left.length ? (
                <select aria-label="Time" value={times[0]} onChange={(e) => setTimes([e.target.value])} className="input">
                  {left.map((t) => (
                    <option key={t} value={t}>
                      {clock(t)}
                    </option>
                  ))}
                </select>
              ) : times.map((t, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input type="time" aria-label="Time" value={t} onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value || "08:00" : x)))} className="input" />
                  {i > 0 && every !== "once" && <IconButton icon="close" label="Remove this time" onClick={() => setTimes(times.filter((_, j) => j !== i))} />}
                </div>
              ))
            )}
            {every !== "hour" && every !== "once" && times.length < MAX_TIMES && (
              <Button size="sm" variant="ghost" icon="plus" className="self-start" onClick={() => setTimes([...times, "17:00"])}>
                Add a time
              </Button>
            )}
          </div>
        </div>
        <ErrorText>{past ? "That time has passed." : error}</ErrorText>
        <div className="flex items-center gap-2">
          {routine && (
            <Button variant="danger" busy={busy === "delete"} disabled={!!busy} onClick={() => void remove()}>
              Delete
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" disabled={!!busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy === "save"} disabled={!!busy || past}>
            {routine ? "Save" : "Add routine"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
