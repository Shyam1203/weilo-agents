import { useEffect, useMemo, useRef, useState } from "react";

const MIN = 80;
const MAX = 640;
const PHONE = 768;

const POLICY = "default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; media-src data: blob: https:; font-src data: https:; connect-src https:";

// The app's colors a page can use, as --weilo-<name>.
const COLORS = { bg: "--color-page", card: "--color-card", text: "--color-ink", muted: "--color-ink-3", line: "--color-line-strong", good: "--color-good", bad: "--color-bad" };

/** The room a page has and the app's look, so it can fit in. */
interface Screen {
  width: number;
  phone: boolean;
  dark: boolean;
  colors: Record<keyof typeof COLORS, string>;
}

// The app's colors are light-dark() pairs: a probe gives the one on screen now.
function screenOf(frame: HTMLElement | null): Screen {
  const probe = document.body.appendChild(document.createElement("span"));
  const colors = Object.fromEntries(Object.entries(COLORS).map(([name, token]) => ((probe.style.color = `var(${token})`), [name, getComputedStyle(probe).color]))) as Screen["colors"];
  probe.remove();
  const [r = 255, g = 255, b = 255] = colors.bg.match(/[\d.]+/g)?.map(Number) ?? [];
  return { width: Math.round(frame?.clientWidth || Math.min(innerWidth, PHONE)), phone: innerWidth < PHONE, dark: 0.2126 * r + 0.7152 * g + 0.0722 * b < 128, colors };
}

// Runs before the page: window.weilo (screen and reply), --weilo-* variables, a "weilo:screen"
// event when the screen changes, and the page's height for its frame.
const bridge = (screen: Screen) => `<script>
const post = (m) => parent.postMessage(m, "*");
const apply = (screen) => {
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(screen.colors)) root.setProperty("--weilo-" + name, value);
  root.setProperty("--weilo-width", screen.width + "px");
  root.colorScheme = screen.dark ? "dark" : "light";
  window.weilo.screen = screen;
  dispatchEvent(new CustomEvent("weilo:screen", { detail: screen }));
};
window.weilo = { reply: (text) => post({ weilo: "reply", text: String(text) }) };
apply(${JSON.stringify(screen)});
addEventListener("message", (e) => e.source === parent && e.data?.weilo === "screen" && apply(e.data.screen));
const size = () => post({ weilo: "height", value: Math.ceil(document.documentElement.getBoundingClientRect().height) });
new ResizeObserver(size).observe(document.documentElement);
addEventListener("load", size);
</script>`;

const documentOf = (html: string, screen: Screen) =>
  `<!doctype html><meta http-equiv="Content-Security-Policy" content="${POLICY}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*,*::before,*::after{box-sizing:border-box}body{margin:12px;font:14px/1.5 system-ui,sans-serif;color:var(--weilo-text)}img,video{max-width:100%;height:auto}</style>${bridge(screen)}${html}`;

interface Props {
  title: string;
  html: string;
  onReply?: (message: string) => void;
}

export function ShowPage({ title, html, onReply }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(MIN * 2);
  const replied = useRef(false);
  const doc = useMemo(() => documentOf(html, screenOf(frame.current)), [html]);

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

  // The page hears when its width or the app's theme changes.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let last = "";
    const tell = () => {
      const screen = screenOf(el);
      const now = JSON.stringify(screen);
      if (now !== last) (last = now), el.contentWindow?.postMessage({ weilo: "screen", screen }, "*");
    };
    const resized = new ResizeObserver(tell);
    resized.observe(el);
    const themed = new MutationObserver(tell);
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", tell);
    el.addEventListener("load", tell);
    return () => (resized.disconnect(), themed.disconnect(), scheme.removeEventListener("change", tell), el.removeEventListener("load", tell));
  }, []);

  return (
    <section className="w-full max-w-full overflow-hidden rounded-2xl border border-line bg-page">
      <iframe ref={frame} title={title || "Page"} sandbox="allow-scripts" srcDoc={doc} referrerPolicy="no-referrer" style={{ height }} className="block w-full border-0" />
    </section>
  );
}
