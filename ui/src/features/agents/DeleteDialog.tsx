// Asks before an agent is deleted: its chat goes with it, unless you clear the box.
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { useAction } from "../../lib/useAction";

interface Props {
  name: string;
  /** `keepChat`: the conversation is not deleted with the agent. */
  onDelete: (keepChat: boolean) => Promise<void>;
  onClose: () => void;
}

export function DeleteDialog({ name, onDelete, onClose }: Props) {
  const { busy, error, run } = useAction();
  const [withChat, setWithChat] = useState(true);
  const remove = () => run("delete", async () => (await onDelete(!withChat), onClose()));

  return (
    <Modal title={`Delete ${name}?`} onClose={busy ? () => {} : onClose} width="max-w-sm">
      <div className="flex flex-col gap-4">
        <label className="flex items-center gap-2.5 text-[14px]">
          <input type="checkbox" checked={withChat} onChange={(e) => setWithChat(e.target.checked)} className="size-4 accent-ink" />
          Also delete the chat
        </label>
        <p className="text-[14px] text-ink-2">You cannot undo this.</p>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={!!busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" busy={!!busy} onClick={() => void remove()}>
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  );
}
