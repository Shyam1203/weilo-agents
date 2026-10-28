import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { cx } from "../../lib/format";
import { useApp } from "../../lib/store";
import { useMedia } from "../../lib/useMedia";
import { PanelIcon } from "../../ui/glyphs";
import { IconButton } from "../../ui/IconButton";
import { ConnectionBanner } from "../shell/Toast";
import { Composer, type ComposerProps } from "./Composer";
import { MessageList, type MessageListProps } from "./MessageList";
import { SidePanel } from "./SidePanel";
import { useFollow, useStickToBottom, useVariant } from "./useThread";

/** Below this width the side panel floats over the conversation instead of squeezing it. */
export const PANEL_INLINE_MIN_WIDTH = 1280;

export interface ThreadScreenProps {
  header: ReactNode;
  /** null shows `children` (a channel's Overview) under the same header. */
  threadId: string | null;
  children?: ReactNode;
  list: Omit<MessageListProps, "threadId">;
  composer: Omit<ComposerProps, "threadId" | "phone">;
  panelOpen?: boolean;
  onPanelClose?: () => void;
  /** Above the messages on phones (the Needs you cards on home). */
  top?: ReactNode;
}

/**
 * Header, conversation, message box, and the side panel when it is open.
 * The header stays mounted when the thread changes (so focus stays on a tab);
 * everything below it starts fresh for each thread.
 */
export function ThreadScreen({ header, threadId, list, composer, panelOpen, onPanelClose, top, children }: ThreadScreenProps) {
  const phone = useVariant() === "phone";
  const wide = useMedia(`(min-width: ${PANEL_INLINE_MIN_WIDTH}px)`);
  const scroll = useRef<HTMLDivElement>(null);
  const thread = useApp((s) => s.snapshot?.threads.find((t) => t.id === threadId));
  useFollow(threadId);
  useStickToBottom(scroll, threadId ?? "");
  const floating = !wide;

  useEffect(() => {
    if (!panelOpen || !floating || !onPanelClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement | null)?.closest("dialog, [role=menu]")) onPanelClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, floating, onPanelClose]);

  // The message column sits on the left with a 24px gutter, like the mock; it stops growing at 768.
  const column = cx("w-full max-w-[768px]", phone ? "px-4" : "px-6");

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <main className={cx("flex min-h-0 min-w-0 flex-1 flex-col", phone ? "bg-bg" : "bg-surface")}>
        {header}
        {threadId === null ? (
          <Fragment key="overview">
            <ConnectionBanner />
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </Fragment>
        ) : (
        <Fragment key={threadId}>
          <ConnectionBanner />
          {top}
          <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto">
            <div className={cx(column, phone ? "py-3" : "py-6")}>
              <MessageList threadId={threadId} {...list} />
            </div>
          </div>
          <div className={cx(column, "shrink-0", phone ? "py-2" : "pb-6")}>
            <Composer threadId={threadId} phone={phone} {...composer} />
          </div>
        </Fragment>
        )}
      </main>
      {panelOpen && thread && !phone && (
        <SidePanel
          key={threadId}
          thread={thread}
          agentName={composer.agentName ?? "Ava"}
          floating={floating}
          onClose={onPanelClose}
        />
      )}
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
