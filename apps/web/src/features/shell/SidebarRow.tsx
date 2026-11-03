import { memo, useCallback, useRef, useState } from "react";
import { call, showError, stop } from "../../lib/app";
import { cx } from "../../lib/format";
import type { SidebarRow as Row } from "../../lib/sidebar";
import { Avatar, SessionMark } from "../../ui/Avatar";
import { Dot } from "../../ui/bits";
import { MoreIcon } from "../../ui/glyphs";
import { IconButton } from "../../ui/IconButton";
import { Link } from "../../ui/Link";
import { Menu, MenuItem } from "../../ui/Menu";
import { useAgentActions } from "./AgentMenu";

const SUB_TONE = { ok: "text-success", warn: "text-warning", quiet: "text-text-tertiary" };

/** An agent (face + live line), a channel (`# slug`) or a session (code icon + who started it). */
export const SidebarRow = memo(function SidebarRow({ row, selected }: { row: Row; selected: boolean }) {
  const [menu, setMenu] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  const two = !!row.sub;
  const agentActions = useAgentActions(row.kind === "agent" ? row.agent : undefined, closeMenu);
  const menuItems = agentActions.items ?? rowMenu(row, closeMenu);
  return (
    <div className="reveal-host relative">
      <Link
        href={row.href}
        aria-current={selected ? "page" : undefined}
        className={cx(
          "flex items-center gap-2 rounded-md px-2 text-body-sm text-text hover:no-underline",
          two ? "h-11" : "h-8",
          menuItems && "pr-8",
          selected ? "bg-accent-subtle" : "hover:bg-surface-muted",
        )}
      >
        {row.kind === "agent" ? (
          <Avatar name={row.name} color={row.agent?.color} size={24} selected={selected} />
        ) : row.kind === "channel" ? (
          <span
            aria-hidden="true"
            className={cx("w-6 shrink-0 text-center text-body font-medium", selected ? "text-accent-text" : "text-text-tertiary")}
          >
            #
          </span>
        ) : (
          <SessionMark size={24} selected={selected} />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cx("ellipsis font-medium", selected ? "text-accent-text" : "text-text")}>
            {row.kind === "channel" && <span className="sr-only">#</span>}
            {row.name}
          </span>
          {row.sub && (
            <span className={cx("ellipsis text-caption", row.tone === "quiet" && selected ? "text-text-secondary" : SUB_TONE[row.tone])}>
              {row.sub}
            </span>
          )}
        </span>
        {row.unread && <Dot label="New" />}
      </Link>
      {menuItems && (
        <div className="absolute top-1/2 right-1 -translate-y-1/2">
          <IconButton
            ref={trigger}
            label={`More for ${row.kind === "channel" ? `#${row.name}` : row.name}`}
            size={24}
            className="reveal-on-hover"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            <MoreIcon />
          </IconButton>
          <Menu open={menu} onClose={closeMenu} anchor={trigger} label="Row actions" className="w-48">
            {menuItems}
          </Menu>
        </div>
      )}
      {agentActions.dialogs}
    </div>
  );
});

function rowMenu(row: Row, close: () => void) {
  const run = (fn: () => Promise<unknown>) => () => {
    close();
    fn().catch(showError);
  };
  if (row.kind === "session" && row.state !== "idle") {
    return <MenuItem onSelect={run(() => stop(row.id))}>Stop session</MenuItem>;
  }
  if (row.kind === "channel") {
    const archived = !!row.archived;
    return (
      <MenuItem onSelect={run(() => call({ method: "archive_channel", params: { channel_id: row.id, archived: !archived } }))}>
        {archived ? "Move back to Channels" : `Archive #${row.name}`}
      </MenuItem>
    );
  }
  return null;
}
