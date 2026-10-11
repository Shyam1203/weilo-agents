// The browser's screen, live: noVNC over the daemon's WebSocket. View only unless `interactive`
// (you took over), when clicks and keys reach the browser.
import RFB from "@novnc/novnc";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/ui/Icon";

type State = "connecting" | "connected" | "closed";

export function LiveView({ interactive = false }: { interactive?: boolean }) {
  const screen = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  const [state, setState] = useState<State>("connecting");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setState("connecting");
    const client = new RFB(screen.current!, `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/browser/view`);
    client.scaleViewport = true;
    client.background = "transparent";
    client.viewOnly = true;
    client.addEventListener("connect", () => setState("connected"));
    client.addEventListener("disconnect", () => setState("closed"));
    rfb.current = client;
    return () => {
      client.disconnect();
      rfb.current = null;
    };
  }, [attempt]);

  // A lost screen (the container restarted, say) is tried again by itself.
  useEffect(() => {
    if (state !== "closed") return;
    const timer = setTimeout(() => setAttempt((n) => n + 1), 5000);
    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (!rfb.current) return;
    rfb.current.viewOnly = !interactive;
  }, [interactive, state]);

  return (
    <div className={`relative aspect-[8/5] w-full overflow-hidden rounded-xl ${state === "connected" ? "bg-white" : "bg-screen"} ring-1 ${interactive ? "ring-2 ring-live" : "ring-line"}`}>
      <div ref={screen} className={`absolute inset-0 ${interactive ? "" : "pointer-events-none"}`} />
      {state !== "connected" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center text-[13px] text-white/70">
          <span className="flex items-center gap-2">
            <Icon name="spinner" size={14} /> {state === "connecting" ? "Connecting…" : "Reconnecting…"}
          </span>
        </div>
      )}
    </div>
  );
}
