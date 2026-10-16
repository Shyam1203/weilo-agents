import { Renderer, type ActionEvent } from "@openuidev/react-lang";
import { library } from "./library";

interface Props {
  source: string;
  streaming: boolean;
  onReply?: (message: string) => void;
}

const valueOf = (x: unknown) => (x && typeof x === "object" && "value" in x ? (x as { value: unknown }).value : x);

// The reply a button sends: its message, then each field of its form by name.
function replyOf({ humanFriendlyMessage, formState, formName, params }: ActionEvent) {
  const form = formName ? (formState?.[formName] as Record<string, unknown> | undefined) : undefined;
  const fields = Object.entries(form ?? {}).flatMap(([name, field]) => {
    const value = valueOf(field);
    return value === undefined || value === "" ? [] : [`- ${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`];
  });
  const context = params.context === undefined ? [] : [`Context: ${JSON.stringify(params.context)}`];
  return [humanFriendlyMessage, ...fields, ...context].filter(Boolean).join("\n");
}

export default function OpenUIBlock({ source, streaming, onReply }: Props) {
  return (
    <Renderer
      response={source}
      library={library}
      isStreaming={streaming}
      onAction={(event) => {
        if (event.type === "open_url" && typeof event.params.url === "string" && /^https?:\/\//i.test(event.params.url)) window.open(event.params.url, "_blank", "noopener,noreferrer");
        else if (event.type === "continue_conversation") onReply?.(replyOf(event));
      }}
    />
  );
}
