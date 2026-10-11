// The browser's screen, live: noVNC over the daemon's WebSocket. View only unless `interactive`
// (you took over), when clicks and keys reach the browser.
import RFB from "@novnc/novnc";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/ui/Icon";

type State = "connecting" | "connected" | "closed";

// The screen is a separate computer, so what you copied here cannot be pasted into it: the text is typed into it instead,
// key by key (a password, say). Long text is cut.
const MAX_TYPED = 2000;
function typeInto(client: RFB, text: string) {
  for (const ch of [...text.replaceAll("\r", "")].slice(0, MAX_TYPED)) {
    if (ch === "\n") client.sendKey(0xff0d, "Enter");
    else if (ch === "\t") client.sendKey(0xff09, "Tab");
    else {
      const code = ch.codePointAt(0)!;
      client.sendKey(code < 0x100 ? code : 0x01000000 + code, null);
    }
  }
}

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

  // Ctrl+V (Cmd+V) types what you copied into the screen; so does the Paste button, which a phone needs.
  const paste = () => {
    const client = rfb.current;
    if (client) void navigator.clipboard.readText().then((text) => typeInto(client, text), () => {});
    client?.focus();
  };
  useEffect(() => {
    const el = screen.current;
    if (!el || !interactive) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "keydown") paste();
      }
    };
    el.addEventListener("keydown", onKey, true);
    el.addEventListener("keyup", onKey, true);
    return () => (el.removeEventListener("keydown", onKey, true), el.removeEventListener("keyup", onKey, true));
  }, [interactive]);

  return (
    <div className={`relative aspect-[8/5] w-full overflow-hidden rounded-xl ${state === "connected" ? "bg-white" : "bg-screen"} ring-1 ${interactive ? "ring-2 ring-live" : "ring-line"}`}>
      <div ref={screen} className={`absolute inset-0 ${interactive ? "" : "pointer-events-none"}`} />
      {interactive && state === "connected" && (
        <button type="button" onClick={paste} className="absolute top-2 right-2 rounded-lg bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm hover:bg-black/75">
          Paste
        </button>
      )}
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
