import { useState } from "react";
import { call, showError } from "../../lib/app";
import { shortName } from "../../lib/format";
import { useApp } from "../../lib/store";
import type { AgentSummary } from "../../proto/AgentSummary";
import { Avatar } from "../../ui/Avatar";
import { EmptyState, TopBar } from "../../ui/bits";
import { PanelToggle, ThreadScreen } from "./ThreadScreen";
import { useThreadState } from "./useThread";

/** An agent's own chat: its name, no `#`. */
export function AgentChat({ agent }: { agent: AgentSummary }) {
  const [panel, setPanel] = useState(false);
  const threadId = agent.main_thread_id;
  const state = useThreadState(threadId);
  const name = shortName(agent.name);
  const live = useApp((s) => s.snapshot?.agents.find((a) => a.id === agent.id)?.live_line ?? "");
  const stopAgent = () => call({ method: "stop_agent", params: { agent_id: agent.id } }).catch(showError);

  return (
    <ThreadScreen
      threadId={threadId}
      panelOpen={panel}
      header={
        <TopBar className="pr-4 pl-6">
          <Avatar name={agent.name} color={agent.color} size={24} />
          <div className="flex min-w-0 flex-1 flex-col">
            <h1 className="m-0 text-title-sm font-semibold whitespace-nowrap">{agent.name}</h1>
            {live && <span className="ellipsis text-caption text-text-tertiary">{live}</span>}
          </div>
          <PanelToggle open={panel} onToggle={() => setPanel((v) => !v)} />
        </TopBar>
      }
      list={{
        agentId: agent.id,
        kind: "agent",
        empty: <EmptyState title={`Say hi to ${name}.`} line="Ask for anything, like “Plan my week”." />,
      }}
      composer={{
        placeholder: `Message ${name}…`,
        label: `Message ${name}`,
        working: state === "working",
        agentName: name,
        onStop: () => void stopAgent(),
      }}
    />
  );
}
