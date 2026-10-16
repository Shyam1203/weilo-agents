import { memo, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const BASE: Components = {
  img: ({ src, alt }) => (
    <a href={typeof src === "string" ? src : undefined} target="_blank" rel="noreferrer noopener">
      {alt || "image"}
    </a>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

const PLUGINS = [remarkGfm];

export const Markdown = memo(function Markdown({ text, components }: { text: string; components?: Components }) {
  const all = useMemo(() => (components ? { ...BASE, ...components } : BASE), [components]);
  return (
    <ReactMarkdown remarkPlugins={PLUGINS} components={all}>
      {text}
    </ReactMarkdown>
  );
});
