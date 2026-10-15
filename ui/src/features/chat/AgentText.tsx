import { isValidElement, memo, useRef, useState, type ReactNode } from "react";
import type { Components } from "react-markdown";
import { Markdown } from "../../components/Markdown";
import { Icon } from "../../components/ui/Icon";
import { useCopy } from "../../lib/useCopy";
import { workspacePath } from "../files/kinds";
import { usePreview } from "../files/PreviewContext";

const LONG_PATH = /^~?\/\S+\/[^\s/]+$/;
const LONG = 28;

const MARKDOWN: Components = {
  code: ({ className, children }) => {
    const text = String(children);
    if (className || text.includes("\n")) return <code className={className}>{children}</code>;
    const path = workspacePath(text);
    if (path) return <FileLink path={path} />;
    return text.length > LONG && LONG_PATH.test(text) ? <ShortPath path={text} /> : <code>{children}</code>;
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  blockquote: ({ children }) => <Quote>{children}</Quote>,
};

function Quote({ children }: { children: ReactNode }) {
  const quote = useRef<HTMLQuoteElement>(null);
  const { copied, copy } = useCopy();
  return (
    <div>
      <blockquote ref={quote}>{children}</blockquote>
      <button type="button" onClick={() => void copy(quote.current?.innerText.trim() ?? "")} className="mt-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-ink-2 hover:bg-select">
        <Icon name={copied ? "check" : "copy"} size={12} /> {copied ? "Copied" : "Copy text"}
      </button>
    </div>
  );
}

function ShortPath({ path }: { path: string }) {
  const [whole, setWhole] = useState(false);
  const toggle = () => setWhole(!whole);
  return (
    <code title={path} role="button" tabIndex={0} aria-expanded={whole} onClick={toggle} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle())} className="cursor-pointer">
      {whole ? path : `…/${path.split("/").pop()}`}
    </code>
  );
}

function FileLink({ path }: { path: string }) {
  const preview = usePreview();
  return (
    <button type="button" onClick={() => preview(path)} title="Preview" className="inline-flex items-center gap-1 rounded-md bg-select px-1.5 py-0.5 align-baseline text-[0.9em] font-medium underline-offset-2 hover:underline">
      <Icon name="file" size={12} className="shrink-0" />
      {path.split("/").pop()}
    </button>
  );
}

function CodeBlock({ children }: { children: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const { copied, copy } = useCopy();
  const className = isValidElement<{ className?: string }>(children) ? children.props.className : undefined;
  const language = /language-([\w+#-]+)/.exec(className ?? "")?.[1] ?? "code";
  return (
    <div className="code-block">
      <div className="flex items-center justify-between border-b border-line bg-page py-0.5 pr-1 pl-3 text-[11px] text-ink-3">
        <span>{language}</span>
        <button type="button" onClick={() => void copy(pre.current?.innerText ?? "")} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-ink-2 hover:bg-select">
          <Icon name={copied ? "check" : "copy"} size={12} /> {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre ref={pre}>{children}</pre>
    </div>
  );
}

export const CardText = memo(({ text }: { text: string }) => (
  <div className="prose-chat text-[13.5px]! leading-relaxed! text-ink-2 [&_strong]:text-ink">
    <Markdown text={text} components={MARKDOWN} />
  </div>
));

export const AgentText = memo(function AgentText({ text }: { text: string }) {
  return (
    <div className="prose-chat w-fit max-w-full rounded-2xl bg-bubble px-3.5 py-2 sm:max-w-[85%]">
      <Markdown text={text} components={MARKDOWN} />
    </div>
  );
});
