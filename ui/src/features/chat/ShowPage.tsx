// A page an agent wrote: HTML with its own CSS and JavaScript, run in a sandboxed frame.
//  - `sandbox` without `allow-same-origin` gives it an empty origin: it can't reach this app, its
//    storage or the API. No popups, forms or top-level navigation.
//  - Its own content policy lets it load from the web (https only: maps, libraries, fonts, pictures),
//    but no frames; the policy of this app's page (see the server) keeps the frame from being
//    navigated anywhere.
//  - It talks to the chat through two messages only: its height, and `weilo.reply("text")`. A reply
//    counts only during a click or key press in the frame (user activation, which a frame passes up
//    to this page, while the frame has focus), so a page can't answer on its own or on a click
//    elsewhere in the app; checked here, as the page could post it directly.
import { useEffect, useMemo, useRef, useState } from "react";

const MIN = 80;
const MAX = 640;

const POLICY = "default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; media-src data: blob: https:; font-src data: https:; connect-src https:";

const BRIDGE = `<script>
const post = (m) => parent.postMessage(m, "*");
window.weilo = { reply: (text) => post({ weilo: "reply", text: String(text) }) };
const size = () => post({ weilo: "height", value: Math.ceil(document.documentElement.getBoundingClientRect().height) });
new ResizeObserver(size).observe(document.documentElement);
addEventListener("load", size);
</script>`;

const documentOf = (html: string) =>
  `<!doctype html><meta http-equiv="Content-Security-Policy" content="${POLICY}"><meta name="referrer" content="no-referrer"><style>:root{color-scheme:light dark}body{margin:12px;font:14px/1.5 system-ui,sans-serif}</style>${html}${BRIDGE}`;

interface Props {
  title: string;
  html: string;
  /** Sends what the page replies; absent when the chat can no longer be answered. */
  onReply?: (message: string) => void;
}

export function ShowPage({ title, html, onReply }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(MIN * 2);
  // One reply per page, like a set of buttons; a page that posts in a loop sends only the first.
  const replied = useRef(false);
  const doc = useMemo(() => documentOf(html), [html]);

  useEffect(() => {
    const listen = ({ source, data }: MessageEvent) => {
      if (source !== frame.current?.contentWindow || !data) return;
      if (data.weilo === "height" && Number.isFinite(data.value)) setHeight(Math.min(Math.max(data.value, MIN), MAX));
      else if (data.weilo === "reply" && onReply && !replied.current && navigator.userActivation?.isActive && document.activeElement === frame.current && typeof data.text === "string" && data.text.trim()) {
        replied.current = true;
        onReply(data.text.slice(0, 2000));
      }
    };
    addEventListener("message", listen);
    return () => removeEventListener("message", listen);
  }, [onReply]);

  return (
    <section className="w-full max-w-full overflow-hidden rounded-2xl border border-line bg-page">
      {title && <h3 className="px-3.5 pt-3 pb-1 text-[13.5px] font-medium">{title}</h3>}
      <iframe ref={frame} title={title || "Page"} sandbox="allow-scripts" srcDoc={doc} referrerPolicy="no-referrer" style={{ height }} className="block w-full border-0" />
    </section>
  );
}
