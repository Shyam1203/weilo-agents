// The agent's text, as Markdown in its bubble: its replies and the text blocks it shows.
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// An agent's text can't load remote images: that would let a prompt-injected agent send data to
// any server by naming it in an image URL. They show as links.
const MARKDOWN: Components = {
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

export function AgentText({ text }: { text: string }) {
  return (
    <div className="prose-chat w-fit max-w-[85%] rounded-2xl bg-bubble px-3.5 py-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
