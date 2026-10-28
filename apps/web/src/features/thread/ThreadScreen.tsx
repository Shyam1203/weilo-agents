import { useRef, type ReactNode } from "react";
import { cx } from "../../lib/format";
import { useApp } from "../../lib/store";
import { PanelIcon } from "../../ui/glyphs";
import { IconButton } from "../../ui/IconButton";
import { ConnectionBanner } from "../shell/Toast";
import { Composer, type ComposerProps } from "./Composer";
import { MessageList, type MessageListProps } from "./MessageList";
import { SidePanel } from "./SidePanel";
import { useFollow, useStickToBottom, useVariant } from "./useThread";

export interface ThreadScreenProps {
  header: ReactNode;
  threadId: string;
  list: Omit<MessageListProps, "threadId">;
  composer: Omit<ComposerProps, "threadId" | "phone">;
  panelOpen?: boolean;
  /** Above the messages on phones (the Needs you cards on home). */
  top?: ReactNode;
}

/** Header, conversation, message box, and the side panel when it is open. */
export function ThreadScreen({ header, threadId, list, composer, panelOpen, top }: ThreadScreenProps) {
  const phone = useVariant() === "phone";
  const scroll = useRef<HTMLDivElement>(null);
  const thread = useApp((s) => s.snapshot?.threads.find((t) => t.id === threadId));
  useFollow(threadId);
  useStickToBottom(scroll, threadId);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className={cx("flex min-h-0 min-w-0 flex-1 flex-col", phone ? "bg-bg" : "bg-surface")}>
        {header}
        <ConnectionBanner />
        {top}
        <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto">
          <div className={cx("mx-auto w-full max-w-[768px]", phone ? "px-4 py-3" : "p-6")}>
            <MessageList threadId={threadId} {...list} />
          </div>
        </div>
        <div className={cx("mx-auto w-full max-w-[768px] shrink-0", phone ? "px-4 py-2" : "px-6 pb-6")}>
          <Composer threadId={threadId} phone={phone} {...composer} />
        </div>
      </main>
      {panelOpen && thread && !phone && <SidePanel thread={thread} agentName={composer.agentName ?? "Ava"} />}
    </div>
  );
}

export function PanelToggle({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return (
    <IconButton label={open ? "Hide side panel" : "Show side panel"} aria-pressed={open} onClick={onToggle}>
      <PanelIcon />
    </IconButton>
  );
}
