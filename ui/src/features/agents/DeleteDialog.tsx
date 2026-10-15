import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { useAction } from "../../lib/useAction";

interface Props {
  name: string;
  folder: string;
  onDelete: (keep: { keepChat: boolean; keepFiles: boolean }) => Promise<void>;
  onClose: () => void;
}

export function DeleteDialog({ name, folder, onDelete, onClose }: Props) {
  const { busy, error, run } = useAction();
  const [withChat, setWithChat] = useState(true);
  const [withFiles, setWithFiles] = useState(false);
  const remove = () => run("delete", async () => (await onDelete({ keepChat: !withChat, keepFiles: !withFiles }), onClose()));

  return (
    <Modal title={`Delete ${name}?`} onClose={busy ? () => {} : onClose} width="max-w-sm">
      <div className="flex flex-col gap-4">
        <label className="flex items-center gap-2.5 text-[14px]">
          <input type="checkbox" checked={withChat} onChange={(e) => setWithChat(e.target.checked)} className="size-4 accent-ink" />
          Also delete the chat
        </label>
        <label className="flex items-center gap-2.5 text-[14px]">
          <input type="checkbox" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} className="size-4 accent-ink" />
          <span>
            Also delete its files, in <code>{folder}/</code>
          </span>
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
