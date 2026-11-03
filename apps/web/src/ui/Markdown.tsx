import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cx } from "../lib/format";

const PLUGINS = [remarkGfm];

/**
 * Agents write Markdown. It is drawn as React elements, never as HTML: raw HTML in a message
 * is dropped, images are not loaded, unsafe link targets are removed
 * (react-markdown's default URL check), and links open in a new tab.
 */
const COMPONENTS: Components = {
  a: ({ node: _node, href, children, ...rest }) => (
    <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  p: ({ node: _node, ...rest }) => <p className="m-0" {...rest} />,
  h1: ({ node: _node, ...rest }) => <p className="m-0 text-title-sm font-semibold" {...rest} />,
  h2: ({ node: _node, ...rest }) => <p className="m-0 text-title-sm font-semibold" {...rest} />,
  h3: ({ node: _node, ...rest }) => <p className="m-0 font-semibold" {...rest} />,
  h4: ({ node: _node, ...rest }) => <p className="m-0 font-semibold" {...rest} />,
  h5: ({ node: _node, ...rest }) => <p className="m-0 font-semibold" {...rest} />,
  h6: ({ node: _node, ...rest }) => <p className="m-0 font-semibold" {...rest} />,
  ul: ({ node: _node, ...rest }) => <ul className="m-0 flex list-disc flex-col gap-1 pl-5" {...rest} />,
  ol: ({ node: _node, ...rest }) => <ol className="m-0 flex list-decimal flex-col gap-1 pl-5" {...rest} />,
  blockquote: ({ node: _node, ...rest }) => (
    <blockquote className="m-0 border-l-2 border-border-strong pl-3 text-text-secondary" {...rest} />
  ),
  hr: () => <hr className="m-0 h-px border-0 bg-border" />,
  pre: ({ node: _node, ...rest }) => (
    <pre
      className="m-0 overflow-x-auto rounded-sm border border-border bg-surface-muted px-3 py-2 font-mono text-body-sm text-text [&>code]:bg-transparent [&>code]:p-0"
      {...rest}
    />
  ),
  code: ({ node: _node, className, ...rest }) => (
    <code className={cx("rounded-sm bg-surface-muted px-1 font-mono text-[0.92em]", className)} {...rest} />
  ),
  table: ({ node: _node, ...rest }) => (
    <div className="max-w-full overflow-x-auto">
      <table className="border-collapse text-body-sm" {...rest} />
    </div>
  ),
  th: ({ node: _node, ...rest }) => <th className="border border-border px-2 py-1 text-left font-semibold" {...rest} />,
  td: ({ node: _node, ...rest }) => <td className="border border-border px-2 py-1 align-top" {...rest} />,
};

export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-2 break-words", className)}>
      <ReactMarkdown
        remarkPlugins={PLUGINS}
        components={COMPONENTS}
        skipHtml
        disallowedElements={["img"]}
        unwrapDisallowed
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
