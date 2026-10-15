// One file preview for the whole chat: anything in it (a file block, a path in the agent's text) opens it with `usePreview()`.
// Paths are the agent's, so the chat's agent is here too, for `useFileUrl()`.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { fileUrl } from "../../api/chat";
import { FilePreview } from "./FilePreview";

type Open = (path: string, name?: string) => void;
type Url = (path: string, view?: boolean) => string;

const PreviewContext = createContext<{ open: Open; url: Url }>({ open: () => {}, url: () => "" });

/** Opens the preview of a file the agent named (its path from the agent's folder, or from the top of the workspace). */
export const usePreview = () => useContext(PreviewContext).open;
/** Where a file the agent named downloads, or shows with `view`. */
export const useFileUrl = () => useContext(PreviewContext).url;

export function PreviewProvider({ agent, children }: { agent: string; children: ReactNode }) {
  const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  const open = useCallback<Open>((path, name) => setFile({ path, name: name ?? (path.split("/").pop() ?? path) }), []);
  const value = useMemo(() => ({ open, url: (path: string, view?: boolean) => fileUrl(agent, path, view) }), [open, agent]);
  return (
    <PreviewContext.Provider value={value}>
      {children}
      {file && <FilePreview path={file.path} name={file.name} onClose={() => setFile(null)} />}
    </PreviewContext.Provider>
  );
}
