import { useState } from "react";
import { Icon, type IconName } from "../../components/ui/Icon";
import type { Step } from "./conversation";

const KINDS: Record<string, { one: string; many: string; icon: IconName }> = {
  read: { one: "Read a file", many: "Read # files", icon: "file" },
  edit: { one: "Edited a file", many: "Edited # files", icon: "file" },
  write: { one: "Edited a file", many: "Edited # files", icon: "file" },
  bash: { one: "Ran a command", many: "Ran # commands", icon: "list" },
  grep: { one: "Searched files", many: "Searched files # times", icon: "search" },
  find: { one: "Searched files", many: "Searched files # times", icon: "search" },
  ls: { one: "Searched files", many: "Searched files # times", icon: "search" },
  browser: { one: "Used the browser", many: "Used the browser # times", icon: "globe" },
  memory: { one: "Used memory", many: "Used memory # times", icon: "brain" },
  fetch_knowledge: { one: "Searched knowledge", many: "Searched knowledge # times", icon: "brain" },
  skill: { one: "Saved a skill", many: "Saved # skills", icon: "sparkle" },
  manage_agents: { one: "Worked on agents", many: "Worked on agents # times", icon: "agent" },
  action: { one: "Worked on an action", many: "Worked on actions # times", icon: "bolt" },
  pin: { one: "Updated a pin", many: "Updated pins # times", icon: "pin" },
};
const kindOf = (tool: string) => KINDS[tool] ?? { one: `Used ${tool}`, many: `Used ${tool} # times`, icon: "puzzle" as IconName };
const SHOWN = 3;

function summary(steps: Step[]) {
  const counts = new Map<string, number>();
  for (const { tool } of steps) if (tool !== "say") counts.set(kindOf(tool).one, (counts.get(kindOf(tool).one) ?? 0) + 1);
  const parts = [...counts].map(([one, n]) => {
    const kind = Object.values(KINDS).find((k) => k.one === one) ?? { one, many: `${one} # times` };
    return n === 1 ? kind.one : kind.many.replace("#", String(n));
  });
  if (!parts.length) return "Thought it over";
  return parts.length > SHOWN ? `${parts.slice(0, SHOWN).join(" · ")} · ${parts.length - SHOWN} more` : parts.join(" · ");
}

export function StepsLine({ steps, working }: { steps: Step[]; working: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start pl-1">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex max-w-full items-center gap-1.5 rounded-md py-0.5 pr-1.5 text-left text-xs text-ink-3 transition-colors hover:text-ink-2">
        {working ? <Icon name="spinner" size={12} className="shrink-0" /> : <Icon name="chevronRight" size={12} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />}
        <span className="truncate">{summary(steps)}</span>
      </button>
      {open && (
        <ol className="mt-1 mb-1 ml-1.5 flex max-w-full flex-col gap-1 border-l border-line pl-3 text-xs text-ink-2">
          {steps.map((step, i) =>
            step.tool === "say" ? (
              <li key={i} className="text-ink-3 italic [overflow-wrap:anywhere]">
                {step.detail}
              </li>
            ) : (
              <li key={i} className="flex min-w-0 items-center gap-1.5">
                <Icon name={kindOf(step.tool).icon} size={12} className="shrink-0 text-ink-3" />
                <span className="shrink-0">{kindOf(step.tool).one}</span>
                {step.detail && <code className="truncate font-mono text-[11px] text-ink-3">{step.detail}</code>}
              </li>
            ),
          )}
        </ol>
      )}
    </div>
  );
}
