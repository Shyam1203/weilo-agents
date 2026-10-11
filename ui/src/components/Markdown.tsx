// Markdown, drawn in the chat's style. Used by the chat and the file preview.
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// An agent's text can't load remote images: that would let a prompt-injected agent send data to
// any server by naming it in an image URL. They show as links.
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

/** `components` replace how an element is drawn (the chat draws a path to a file as a link to its preview). */
export function Markdown({ text, components }: { text: string; components?: Components }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components ? { ...BASE, ...components } : BASE}>
      {text}
    </ReactMarkdown>
  );
}
