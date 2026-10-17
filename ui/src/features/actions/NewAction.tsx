import { useState, type FormEvent } from "react";
import { addAction, type Action } from "../../api/actions";
import { Button } from "../../components/ui/Button";
import { ErrorText, Field } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { useAction } from "../../lib/useAction";

interface Props {
  agentId: string;
  agentName: string;
  onMade: (action: Action) => void;
  onClose: () => void;
}

export function NewAction({ agentId, agentName, onMade, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [request, setRequest] = useState("");
  const { busy, error, run } = useAction();
  const make = (e: FormEvent) => (e.preventDefault(), void run("make", async () => onMade(await addAction(agentId, { title, request }))));
  return (
    <Modal title="New action" onClose={onClose} width="max-w-md">
      <form onSubmit={make} className="flex flex-col gap-4">
        <Field label="Name">
          <input autoFocus value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="Check my order" className="input" />
        </Field>
        <Field label={`What should ${agentName} do?`}>
          <textarea value={request} rows={3} onChange={(e) => setRequest(e.target.value)} placeholder="Check my Thai Basil order and tell me when it arrives" className="input resize-none" />
        </Field>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" busy={!!busy} disabled={!title.trim() || !request.trim()}>
            Make it
          </Button>
        </div>
      </form>
    </Modal>
  );
}
