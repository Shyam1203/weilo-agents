import type { Action, ActionRun } from "../../api/actions";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Time } from "../chat/ReplyActions";

interface Props {
  action: Action;
  run?: ActionRun;
  latest: boolean;
  agentName: string;
  onAgain: () => void;
  onAsk: () => void;
  onFix: () => void;
}

export function ActionResult({ action, run, latest, agentName, onAgain, onAsk, onFix }: Props) {
  const failed = run && !run.ok;
  return (
    <section aria-label={`${action.title}: answer`} className={`w-full max-w-[85%] animate-fade-in overflow-hidden rounded-2xl ring-1 ${failed ? "ring-bad/30" : "ring-line"}`}>
      <div className={`flex items-center gap-2 border-b px-3.5 py-2 text-xs text-ink-3 ${failed ? "border-bad/20 bg-bad-soft" : "border-line bg-panel"}`}>
        <Icon name={run?.by === "schedule" ? "clock" : action.icon} size={13} className="shrink-0 text-ink" />
        <span className="font-medium text-ink">{action.title}</span>
        <span className="min-w-0 flex-1 truncate">{!run ? "· working on it…" : run.by === "schedule" ? "· ran by itself" : "· you tapped it"}</span>
        {run && <Time at={run.at / 1000} />}
      </div>
      <div className="flex flex-col gap-2.5 px-3.5 py-3">
        {!run ? (
          <p className="flex items-center gap-2 text-[14px] text-ink-3">
            <Icon name="spinner" size={14} /> Working on it…
          </p>
        ) : (
          <p className={`text-[14px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] ${failed ? "text-bad" : ""}`}>{run.text.replace(/^Failed: /, "Didn't work: ")}</p>
        )}
        {run && latest && (
          <div className="flex flex-wrap gap-1.5">
            {run.ok ? (
              <>
                <Button size="sm" icon="retry" onClick={onAgain}>Run again</Button>
                <Button size="sm" onClick={onAsk}>Ask {agentName} about it</Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="primary" onClick={onFix}>Ask {agentName} to fix it</Button>
                <Button size="sm" icon="retry" onClick={onAgain}>Try again</Button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
