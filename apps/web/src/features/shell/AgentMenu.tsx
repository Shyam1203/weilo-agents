import { useCallback, useRef, useState } from "react";
import { stopAgent } from "../../lib/app";
import { shortName } from "../../lib/format";
import { hostAway, useApp } from "../../lib/store";
import type { AgentSummary } from "../../proto/AgentSummary";
import { MoreIcon } from "../../ui/glyphs";
import { IconButton } from "../../ui/IconButton";
import { Menu, MenuItem } from "../../ui/Menu";
import { ChangeAiDialog, RemoveAgentDialog } from "./dialogs";

/**
 * An agent's actions, for its sidebar row's ⋯ and its page's ⋯: Stop (while it works),
 * Change AI, and Remove agent (not for the main agent, whose chat is home).
 */
export function useAgentActions(agent: AgentSummary | undefined, close: () => void) {
  const [dialog, setDialog] = useState<"ai" | "remove" | null>(null);
  const isMain = useApp((s) => s.snapshot?.agents[0]?.id === agent?.id);
  const away = useApp(hostAway);
  if (!agent) return { items: null, dialogs: null };
  const name = shortName(agent.name);
  const pick = (d: "ai" | "remove") => () => {
    close();
    setDialog(d);
  };
  const items = (
    <>
      {agent.state === "working" && !away && (
        <MenuItem
          onSelect={() => {
            close();
            void stopAgent(agent);
          }}
        >
          Stop {name}
        </MenuItem>
      )}
      <MenuItem onSelect={pick("ai")}>Change AI</MenuItem>
      {!isMain && <MenuItem onSelect={pick("remove")}>Remove {name}</MenuItem>}
    </>
  );
  const dialogs = (
    <>
      <ChangeAiDialog open={dialog === "ai"} onClose={() => setDialog(null)} agent={agent} />
      {!isMain && <RemoveAgentDialog open={dialog === "remove"} onClose={() => setDialog(null)} agent={agent} />}
    </>
  );
  return { items, dialogs };
}

/** The ⋯ in an agent's own header. */
export function AgentMenuButton({ agent, phone }: { agent: AgentSummary; phone?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const { items, dialogs } = useAgentActions(agent, close);
  return (
    <div className="relative">
      <IconButton
        ref={trigger}
        label={`More for ${shortName(agent.name)}`}
        size={phone ? 44 : 32}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreIcon />
      </IconButton>
      <Menu open={open} onClose={close} anchor={trigger} label={`${shortName(agent.name)} actions`} className="w-48">
        {items}
      </Menu>
      {dialogs}
    </div>
  );
}
