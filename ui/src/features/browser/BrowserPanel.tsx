// The top of the chat's right-hand panel: the browser's screen, showing the agent's window. You can
// take over: the agent stops and waits, and you use its window until you give it back. The screen
// loads on first use: noVNC is large.
import { lazy, Suspense, useEffect, useState } from "react";
import { browserState, giveBack, showBrowser, takeOver } from "../../api/browser";
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

export function BrowserPanel({ agentId, agentName, off, onTaken }: { agentId: string; agentName: string; off: boolean; onTaken: () => void }) {
  const [taken, setTaken] = useState(false);
  const [hasWindow, setHasWindow] = useState(false);
  const [open, setOpen] = useState(false);
  const { busy, error, run } = useAction();

  // The screen has one window in front: this agent's.
  useEffect(() => {
    setTaken(false);
    setHasWindow(false);
    if (off) return;
    void browserState(agentId).then((s) => (setTaken(s.taken), setHasWindow(s.hasWindow)), () => {});
    void showBrowser(agentId).catch(() => {});
  }, [agentId, off]);

  // An agent opens its window the first time it uses the browser: look again now and then until it has one.
  useEffect(() => {
    if (off || hasWindow) return;
    const timer = setInterval(() => void browserState(agentId).then((s) => (setTaken(s.taken), setHasWindow(s.hasWindow)), () => {}), 3000);
    return () => clearInterval(timer);
  }, [agentId, off, hasWindow]);

  const open_ = () => hasWindow && (void showBrowser(agentId).catch(() => {}), setOpen(true));
  // The agent list shows who has taken a browser: it learns of the change now.
  const take = () => run("take", async () => (await takeOver(agentId), setTaken(true), setHasWindow(true), setOpen(true), onTaken()));
  const give = () => run("give", async () => (await giveBack(agentId), setTaken(false), setOpen(false), onTaken()));
  const action = taken ? (
    <Button size="sm" variant="primary" busy={busy === "give"} disabled={!!busy} onClick={() => void give()}>
      Give back
    </Button>
  ) : (
    <Button size="sm" icon="pointer" busy={busy === "take"} disabled={!!busy} onClick={() => void take()}>
      Take over
    </Button>
  );

  // Turned off for this agent: the screen stays blank, so it does not show another agent's window.
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
        {action}
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
      <p className="text-xs text-ink-3">{taken ? `You are in control. ${agentName} waits until you give it back.` : hasWindow ? `${agentName}'s browser window.` : `${agentName} has not used the browser yet. It opens a window when it does.`}</p>
      <ErrorText>{error}</ErrorText>
      {open && (
        <Modal title="Browser" onClose={() => setOpen(false)} width="max-w-5xl">
          <div className="flex flex-col gap-4">
            <Suspense fallback={<Loading />}>
              <LiveView interactive={taken} />
            </Suspense>
            <div className="flex items-center gap-3">
              <p className="flex-1 text-[13px] text-ink-2">{taken ? "Click Give back when you finish. Then the agent carries on." : "Take over to sign in to a site, or to finish a step yourself."}</p>
              {action}
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
