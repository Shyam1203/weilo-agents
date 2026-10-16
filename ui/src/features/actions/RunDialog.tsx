import { useState, type FormEvent } from "react";
import type { Action } from "../../api/actions";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { read, write } from "../../lib/storage";

const lastKey = (id: string) => `weilo.action.${id}`;

function lastValues(action: Action): Record<string, string> {
  let saved: Record<string, string> = {};
  try {
    saved = JSON.parse(read(lastKey(action.id)) ?? "{}");
  } catch {}
  return Object.fromEntries(action.fields.map((f) => [f.name, saved[f.name] ?? f.default ?? ""]));
}

interface Props {
  action: Action;
  agentName: string;
  onRun: (input: Record<string, string>) => void;
  onClose: () => void;
}

/** What an action needs before it runs: its fields (last values filled in), and a confirmation where it asks for one. */
export function RunDialog({ action, agentName, onRun, onClose }: Props) {
  const [values, setValues] = useState(() => lastValues(action));
  const ready = action.fields.every((f) => values[f.name]?.trim());
  const run = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    write(lastKey(action.id), JSON.stringify(values));
    onRun(values);
  };
  const confirmScript = action.confirm && action.kind === "script";
  return (
    <Modal title={action.title} onClose={onClose} width="max-w-md">
      <form onSubmit={run} className="flex flex-col gap-4">
        {action.about && <p className="text-[13.5px] text-ink-2">{action.about}</p>}
        {action.fields.map((f, i) => (
          <Field key={f.name} label={f.label}>
            {f.options ? (
              <Select label={f.label} value={values[f.name]} onChange={(v) => setValues({ ...values, [f.name]: v })} options={f.options.map((o) => ({ value: o, label: o }))} placeholder="Choose" />
            ) : (
              <input autoFocus={i === 0} value={values[f.name]} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} className="input" />
            )}
          </Field>
        ))}
        {action.confirm && (
          <p className="rounded-xl bg-card px-3 py-2.5 text-[13px] text-ink-2">
            {confirmScript ? "This can pay or send something." : `${agentName} asks you before paying or sending.`}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" icon="play" disabled={!ready}>
            {confirmScript ? "Confirm and run" : "Run"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
