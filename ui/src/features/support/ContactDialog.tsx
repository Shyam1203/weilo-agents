// "Contact us": a message to Weilo, for a problem, an idea or a question. It goes to Weilo with the app's version.
import { useState, type FormEvent } from "react";
import { sendContact, TOPICS, type Contact } from "../../api/app";
import { Button } from "../../components/ui/Button";
import { ErrorText, Field } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Select";
import { MAX_CONTACT_EMAIL, MAX_CONTACT_MESSAGE, MAX_CONTACT_NAME } from "../../lib/limits";
import { useAction } from "../../lib/useAction";

/** `name` is what the app already calls the user. */
export function ContactDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const [draft, setDraft] = useState<Contact>({ name, email: "", topic: "Problem", message: "" });
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();
  const change = (patch: Partial<Contact>) => setDraft((d) => ({ ...d, ...patch }));
  const submit = (e: FormEvent) => (e.preventDefault(), void run("send", async () => (await sendContact(draft), setSent(true))));

  return (
    <Modal title="Contact us" onClose={onClose}>
      {sent ? (
        <div className="flex flex-col items-start gap-4">
          <p className="text-[14px] leading-relaxed">Thank you. We got your message and will answer at {draft.email}.</p>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="hint">Tell us what went wrong, what you would like, or ask anything. We get your message, name and email, and the version of this app. Nothing from your chats.</p>
          <Field label="About">
            <Select label="About" value={draft.topic} options={TOPICS.map((t) => ({ value: t, label: t }))} onChange={(topic) => change({ topic: topic as Contact["topic"] })} />
          </Field>
          <Field label="Your name (optional)">
            <input value={draft.name} maxLength={MAX_CONTACT_NAME} onChange={(e) => change({ name: e.target.value })} className="input" />
          </Field>
          <Field label="Your email" hint="So we can answer you.">
            <input type="email" required autoComplete="email" value={draft.email} maxLength={MAX_CONTACT_EMAIL} onChange={(e) => change({ email: e.target.value })} className="input" />
          </Field>
          <Field label="Message">
            <textarea required rows={6} value={draft.message} maxLength={MAX_CONTACT_MESSAGE} onChange={(e) => change({ message: e.target.value })} className="input resize-y" />
          </Field>
          <ErrorText>{error}</ErrorText>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" busy={!!busy} disabled={!draft.email.trim() || draft.message.trim().length < 10}>
              Send
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
