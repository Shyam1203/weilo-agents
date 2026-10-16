import { useState, type FormEvent } from "react";
import { saveUser, type User } from "../../api/user";
import { Button } from "../../components/ui/Button";
import { ErrorText, Field } from "../../components/ui/Field";
import { MAX_ABOUT, MAX_NAME } from "../../lib/limits";
import { useAction } from "../../lib/useAction";

interface Props {
  user: User;
  onSaved: () => void;
  onSkip?: () => void;
}

export function AboutYouForm({ user, onSaved, onSkip }: Props) {
  const [draft, setDraft] = useState(user);
  const { busy, error, run } = useAction();
  const save = (e: FormEvent) => (e.preventDefault(), run("save", async () => (await saveUser(draft), onSaved())));

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <Field label="Your name" hint="Agents use it to talk to you.">
        <input autoFocus value={draft.name} maxLength={MAX_NAME} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="input" />
      </Field>
      <Field label="About you" hint="Optional. Your work, city, or how you like answers.">
        <textarea value={draft.about} maxLength={MAX_ABOUT} rows={4} onChange={(e) => setDraft({ ...draft, about: e.target.value })} className="input resize-none" />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        {onSkip && (
          <Button variant="ghost" disabled={!!busy} onClick={onSkip}>
            Skip
          </Button>
        )}
        <Button type="submit" variant="primary" busy={!!busy}>
          Save
        </Button>
      </div>
    </form>
  );
}
