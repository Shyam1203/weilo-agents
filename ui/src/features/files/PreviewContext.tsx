import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { fileUrl } from "../../api/chat";
import { FilePreview } from "./FilePreview";

type Open = (path: string, name?: string) => void;
type Url = (path: string, view?: boolean) => string;

const PreviewContext = createContext<{ open: Open; url: Url }>({ open: () => {}, url: () => "" });

export const usePreview = () => useContext(PreviewContext).open;
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
