// The agent's text, as Markdown in its bubble: its replies and the text blocks it shows.
import { isValidElement, useRef, type ReactNode } from "react";
import type { Components } from "react-markdown";
import { Markdown } from "../../components/Markdown";
import { Icon } from "../../components/ui/Icon";
import { useCopy } from "../../lib/useCopy";
import { workspacePath } from "../files/kinds";
import { usePreview } from "../files/PreviewContext";

const MARKDOWN: Components = {
  // A file of the workspace named in the text opens in the preview.
  code: ({ className, children }) => {
    const text = String(children);
    const path = className || text.includes("\n") ? null : workspacePath(text);
    return path ? <FileLink path={path} /> : <code className={className}>{children}</code>;
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
};

function FileLink({ path }: { path: string }) {
  const preview = usePreview();
  return (
    <button type="button" onClick={() => preview(path)} title="Preview" className="inline-flex items-center gap-1 rounded-md bg-select px-1.5 py-0.5 align-baseline text-[0.9em] font-medium underline-offset-2 hover:underline">
      <Icon name="file" size={12} className="shrink-0" />
      {path.split("/").pop()}
    </button>
  );
}

/** A code block under a bar with its language and a Copy button. */
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

export function AgentText({ text }: { text: string }) {
  // A phone's screen is narrow: a reply takes all of it.
  return (
    <div className="prose-chat w-fit max-w-full rounded-2xl bg-bubble px-3.5 py-2 sm:max-w-[85%]">
      <Markdown text={text} components={MARKDOWN} />
    </div>
  );
}
