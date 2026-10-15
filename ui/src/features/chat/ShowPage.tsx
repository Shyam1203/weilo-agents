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
  onReply?: (message: string) => void;
}

export function ShowPage({ title, html, onReply }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(MIN * 2);
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
      <iframe ref={frame} title={title || "Page"} sandbox="allow-scripts" srcDoc={doc} referrerPolicy="no-referrer" style={{ height }} className="block w-full border-0" />
    </section>
  );
}
