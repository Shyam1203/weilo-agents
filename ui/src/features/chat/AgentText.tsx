// The agent's text, as Markdown in its bubble: its replies and the text blocks it shows.
import type { Components } from "react-markdown";
import { Markdown } from "../../components/Markdown";
import { Icon } from "../../components/ui/Icon";
import { workspacePath } from "../files/kinds";
import { usePreview } from "../files/PreviewContext";

const MARKDOWN: Components = {
  // A file of the workspace named in the text opens in the preview.
  code: ({ className, children }) => {
    const text = String(children);
    const path = className || text.includes("\n") ? null : workspacePath(text);
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

export function AgentText({ text }: { text: string }) {
  return (
    <div className="prose-chat w-fit max-w-[85%] rounded-2xl bg-bubble px-3.5 py-2">
      <Markdown text={text} components={MARKDOWN} />
    </div>
  );
}
