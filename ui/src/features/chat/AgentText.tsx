// The agent's text, as Markdown in its bubble: its replies and the text blocks it shows.
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "../../components/ui/Icon";
import { workspacePath } from "../files/kinds";
import { usePreview } from "../files/PreviewContext";

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
  // A file of the workspace named in the text opens in the preview.
  code: ({ className, children }) => {
    const path = className ? null : workspacePath(String(children));
    return path ? <FileLink path={path} /> : <code className={className}>{children}</code>;
  },
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

/** Markdown, drawn in the chat's style. */
export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN}>
      {text}
    </ReactMarkdown>
  );
}

export function AgentText({ text }: { text: string }) {
  return (
    <div className="prose-chat w-fit max-w-[85%] rounded-2xl bg-bubble px-3.5 py-2">
      <Markdown text={text} />
    </div>
  );
}
