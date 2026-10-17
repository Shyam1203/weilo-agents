import { lazy, Suspense, useEffect, useState } from "react";
import { browserState, finishTeaching, giveBack, showBrowser, startTeaching, takeOver } from "../../api/browser";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { Modal } from "../../components/ui/Modal";
import { useAction } from "../../lib/useAction";

const LiveView = lazy(() => import("./LiveView").then((m) => ({ default: m.LiveView })));

const Loading = () => (
  <div className="flex aspect-[8/5] w-full items-center justify-center gap-2 rounded-xl bg-screen text-[13px] text-white/70">
    <Icon name="spinner" size={14} /> Loading…
  </div>
);

export function BrowserPanel({ agentId, agentName, off, taken: takenNow, open: openNow, onTaken }: { agentId: string; agentName: string; off: boolean; taken: boolean; open: boolean; onTaken: () => void }) {
  const [taken, setTaken] = useState(false);
  const [hasWindow, setHasWindow] = useState(false);
  const [open, setOpen] = useState(false);
  const [teaching, setTeaching] = useState<number | null>(null);
  const [goal, setGoal] = useState("");
  const { busy, error, run } = useAction();

  useEffect(() => {
    setTaken(false);
    setHasWindow(false);
    setTeaching(null);
    if (off) return;
    void browserState(agentId).then((s) => (setTaken(s.taken), setHasWindow(s.hasWindow), setTeaching(s.teaching)), () => {});
    void showBrowser(agentId).catch(() => {});
  }, [agentId, off]);

  useEffect(() => {
    setTaken(takenNow);
    if (!takenNow) setTeaching(null);
  }, [takenNow]);
  const recording = teaching !== null;
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => void browserState(agentId).then((s) => setTeaching(s.teaching), () => {}), 2000);
    return () => clearInterval(timer);
  }, [agentId, recording]);
  useEffect(() => setHasWindow(openNow), [openNow]);

  const open_ = () => hasWindow && (void showBrowser(agentId).catch(() => {}), setOpen(true));
  const take = () => run("take", async () => (await takeOver(agentId), setTaken(true), setHasWindow(true), setOpen(true), onTaken()));
  const give = () => run("give", async () => (await giveBack(agentId), setTaken(false), setTeaching(null), setOpen(false), onTaken()));
  const teach = () => run("teach", async () => (await startTeaching(agentId), setTaken(true), setHasWindow(true), setTeaching(0), setGoal(""), setOpen(true), onTaken()));
  const done = () => run("done", async () => (await finishTeaching(agentId, goal.trim()), setTaken(false), setTeaching(null), setOpen(false), onTaken()));
  const action = recording ? (
    <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void give()}>
      Cancel
    </Button>
  ) : taken ? (
    <Button size="sm" variant="primary" busy={busy === "give"} disabled={!!busy} onClick={() => void give()}>
      Give back
    </Button>
  ) : (
    <div className="flex gap-2">
      <Button size="sm" icon="teach" busy={busy === "teach"} disabled={!!busy} onClick={() => void teach()}>
        Show how
      </Button>
      <Button size="sm" icon="pointer" busy={busy === "take"} disabled={!!busy} onClick={() => void take()}>
        Take over
      </Button>
    </div>
  );
  const bar = recording && (
    <form className="flex flex-col gap-1.5" onSubmit={(e) => (e.preventDefault(), void done())}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 text-[13px] font-medium whitespace-nowrap">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-live" />
          Recording · {teaching === 1 ? "1 step" : `${teaching} steps`}
        </span>
        <input value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={200} aria-label="What did you show?" placeholder="What is it? Like: Reorder my usual groceries" className="input h-8 min-w-[12rem] flex-1 text-[13px]" />
        {action}
        <Button type="submit" size="sm" variant="primary" busy={busy === "done"} disabled={!!busy || !goal.trim()}>
          Done
        </Button>
      </div>
      <p className="text-xs text-ink-3">Do the task once, say what it is, then click Done. Passwords are never recorded.</p>
    </form>
  );


  if (off) {
    return (
      <section className="flex flex-col gap-3 p-4 pb-0">
        <h2 className="text-[13px] font-medium text-ink-2">Browser</h2>
        <div className="flex aspect-[8/5] w-full items-center justify-center rounded-xl bg-screen px-4 text-center text-[13px] text-white/70">Browser is turned off for this agent.</div>
        <p className="text-xs text-ink-3">Turn it on in {agentName}'s settings to let it use websites.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 p-4 pb-0">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-ink-2">Browser</h2>
        {!recording && action}
      </div>
      <div role={hasWindow ? "button" : undefined} tabIndex={hasWindow ? 0 : undefined} aria-label={hasWindow ? "Open the browser" : undefined} onClick={open_} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open_())} className="group relative block w-full cursor-pointer text-left">
        {!hasWindow ? (
          <div className="flex aspect-[8/5] w-full items-center justify-center rounded-xl bg-screen px-4 text-center text-[13px] text-white/70">No browser window yet.</div>
        ) : open ? (
          <Loading />
        ) : (
          <Suspense fallback={<Loading />}>
            <LiveView />
          </Suspense>
        )}
        {hasWindow && <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100 group-focus-visible:bg-black/35 group-focus-visible:opacity-100">
          <span className="rounded-lg bg-black/70 px-3 py-1.5 text-xs font-medium text-white">Open</span>
        </span>}
      </div>
      {bar || <p className="text-xs text-ink-3">{taken ? `You are in control. ${agentName} waits until you give it back.` : hasWindow ? `${agentName}'s browser window.` : `${agentName} has not used the browser yet. It opens a window when it does.`}</p>}
      <ErrorText>{error}</ErrorText>
      {open && (
        <Modal title="Browser" onClose={() => setOpen(false)} width="max-w-5xl">
          <div className="flex flex-col gap-4">
            <Suspense fallback={<Loading />}>
              <LiveView interactive={taken} />
            </Suspense>
            {bar || (
              <div className="flex items-center gap-3">
                <p className="flex-1 text-[13px] text-ink-2">{taken ? "Click Give back when you finish. Then the agent carries on." : "Take over to sign in to a site, or to finish a step yourself. Show how teaches the agent a task."}</p>
                {action}
              </div>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
