import { Modal } from "../../components/ui/Modal";
import type { User } from "../../api/user";
import { AboutYouForm } from "./AboutYouForm";

/** The first screen: agents should know your name. Skip leaves it for Settings > About you. */
export function Welcome({ user, onDone }: { user: User; onDone: () => void }) {
  return (
    <Modal title="Welcome to Weilo Agents" onClose={onDone} width="max-w-md">
      <div className="flex flex-col gap-4">
        <p className="text-[14px] text-ink-2">Tell your agents who you are. You can change this later in Settings.</p>
        <AboutYouForm user={user} onSaved={onDone} onSkip={onDone} />
      </div>
    </Modal>
  );
}
