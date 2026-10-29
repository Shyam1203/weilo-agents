import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { cx } from "../../lib/format";
import { store, useApp } from "../../lib/store";
import { useMedia } from "../../lib/useMedia";
import { PanelIcon } from "../../ui/glyphs";
import { IconButton } from "../../ui/IconButton";
import { ConnectionBanner } from "../shell/Toast";
import { Composer, type ComposerProps } from "./Composer";
import { MessageList, type MessageListProps } from "./MessageList";
import { SidePanel } from "./SidePanel";
import type { SessionChanges } from "../../proto/SessionChanges";
import { useFollow, useStickToBottom, useVariant } from "./useThread";

/** From this width the side panel opens by itself, next to the sidebar and the chat. */
export const PANEL_INLINE_MIN_WIDTH = 1280;
/** Below this width (rail 80 + chat 480 + panel 400) the side panel floats over the chat, with a scrim. */
export const PANEL_BESIDE_MIN_WIDTH = 960;

export interface ThreadScreenProps {
  header: ReactNode;
  /** null shows `children` (a channel's Overview) under the same header. */
  threadId: string | null;
  children?: ReactNode;
  list: Omit<MessageListProps, "threadId">;
  composer: Omit<ComposerProps, "threadId" | "phone">;
  panelOpen?: boolean;
  onPanelClose?: () => void;
  /** A session's changes, for its side panel. */
  changes?: SessionChanges | null;
  /** Under the messages (a channel chat's sessions that need you). */
  after?: ReactNode;
  /** Above the messages on phones (the Needs you cards on home). */
  top?: ReactNode;
}

/**
 * Header, conversation, message box, and the side panel when it is open.
 * The header stays mounted when the thread changes (so focus stays on a tab);
 * everything below it starts fresh for each thread.
 */
export function ThreadScreen({ header, threadId, list, composer, panelOpen, onPanelClose, top, changes, after, children }: ThreadScreenProps) {
  const phone = useVariant() === "phone";
  const wide = useMedia(`(min-width: ${PANEL_BESIDE_MIN_WIDTH}px)`);
  const scroll = useRef<HTMLDivElement>(null);
  const thread = useApp((s) => s.snapshot?.threads.find((t) => t.id === threadId));
  useFollow(threadId);
  useStickToBottom(scroll, threadId ?? "");
  const floating = !wide;
  const showPanel = !!panelOpen && !!thread && !phone;

  // The shell folds the sidebar on mid-width windows while a panel is open.
  useEffect(() => {
    if (!showPanel) return;
    store.set((s) => ({ ...s, panelOpen: true }));
    return () => store.set((s) => ({ ...s, panelOpen: false }));
  }, [showPanel]);

  useEffect(() => {
    if (!panelOpen || !floating || !onPanelClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement | null)?.closest("dialog, [role=menu]")) onPanelClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, floating, onPanelClose]);

  // The message column is centred, like the mock: 720 wide plus its 24px gutters, and it
  // takes the width there is on narrower windows.
  const column = cx("mx-auto w-full max-w-[768px]", phone ? "px-4" : "px-6");

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
            {/* Under the Needs you cards, the chat fades in instead of being cut by a hard edge. */}
            {top && <div aria-hidden="true" className="pointer-events-none sticky top-0 z-[1] -mb-4 h-4 bg-linear-to-b from-bg to-transparent" />}
            <div className={cx(column, phone ? "py-3" : "py-6")}>
              <MessageList threadId={threadId} {...list} tail={after} />
            </div>
          </div>
          <div className={cx(column, "shrink-0", phone ? "py-2" : "pb-6")}>
            <Composer threadId={threadId} phone={phone} {...composer} />
          </div>
        </Fragment>
        )}
      </main>
      {showPanel && floating && onPanelClose && (
        <div aria-hidden="true" className="absolute inset-0 z-10 bg-[var(--scrim)]" onClick={onPanelClose} />
      )}
      {showPanel && thread && (
        <SidePanel
          key={threadId}
          thread={thread}
          changes={changes}
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
