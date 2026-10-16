import type { Action } from "../../api/actions";
import { Button, IconButton } from "../../components/ui/Button";
import { Icon } from "../../components/ui/Icon";
import { Time } from "../chat/ReplyActions";

export interface Run {
  key: number;
  action: Action;
  done: boolean;
  ok?: boolean;
  text?: string;
  ms?: number;
  at?: number;
}

interface Props {
  run: Run;
  agentName: string;
  onAgain: () => void;
  onAsk: () => void;
  onFix: () => void;
  onClose: () => void;
}

/** What a script action answered, in the chat. The agent does not see it unless you ask it about it. */
export function ActionResult({ run, agentName, onAgain, onAsk, onFix, onClose }: Props) {
  return (
    <section aria-label={`${run.action.title}: result`} className="w-full max-w-[85%] animate-fade-in overflow-hidden rounded-2xl ring-1 ring-line">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3.5 py-2 text-xs text-ink-3">
        <Icon name="bolt" size={13} className="shrink-0 text-ink" />
        <span className="font-medium text-ink">{run.action.title}</span>
        <span className="min-w-0 flex-1 truncate">{run.done ? `script · ${((run.ms ?? 0) / 1000).toFixed(1)} s · no tokens` : "running…"}</span>
        {run.at && <Time at={run.at / 1000} />}
        <IconButton icon="close" label="Close" onClick={onClose} className="-my-1 -mr-2 size-7" />
      </div>
      <div className="flex flex-col gap-2.5 px-3.5 py-3">
        {run.done ? (
          <p className={`text-[14px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere] ${run.ok ? "" : "text-bad"}`}>{run.text}</p>
        ) : (
          <p className="flex items-center gap-2 text-[14px] text-ink-3">
            <Icon name="spinner" size={14} /> Running…
          </p>
        )}
        {run.done && (
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
