import { useState } from "react";
import { call, showError } from "../../lib/app";
import { shortName } from "../../lib/format";
import { useApp } from "../../lib/store";
import type { AgentSummary } from "../../proto/AgentSummary";
import { MoreIcon } from "../../ui/glyphs";
import { IconButton } from "../../ui/IconButton";
import { MenuItem, Popover } from "../../ui/Popover";
import { ChangeAiDialog, RemoveAgentDialog } from "./dialogs";

/**
 * An agent's actions, for its sidebar row's ⋯ and its page's ⋯: Stop (while it works),
 * Change AI, and Remove agent (not for the main agent, whose chat is home).
 */
export function useAgentActions(agent: AgentSummary | undefined, close: () => void) {
  const [dialog, setDialog] = useState<"ai" | "remove" | null>(null);
  const isMain = useApp((s) => s.snapshot?.agents[0]?.id === agent?.id);
  if (!agent) return { items: null, dialogs: null };
  const name = shortName(agent.name);
  const pick = (d: "ai" | "remove") => () => {
    close();
    setDialog(d);
  };
  const items = (
    <>
      {agent.state === "working" && (
        <MenuItem
          onSelect={() => {
            close();
            call({ method: "stop_agent", params: { agent_id: agent.id } }).catch(showError);
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
  const { items, dialogs } = useAgentActions(agent, () => setOpen(false));
  return (
    <div className="relative">
      <IconButton
        label={`More for ${shortName(agent.name)}`}
        size={phone ? 44 : 32}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreIcon />
      </IconButton>
      <Popover open={open} onClose={() => setOpen(false)} label={`${shortName(agent.name)} actions`} role="menu" className="top-10 right-0 w-48">
        {items}
      </Popover>
      {dialogs}
    </div>
  );
}
