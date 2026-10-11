// One file preview for the whole chat: anything in it (a file block, a path in the agent's text) opens it with `usePreview()`.
import { createContext, useContext, useState, type ReactNode } from "react";
import { FilePreview } from "./FilePreview";

type Open = (path: string, name?: string) => void;

const PreviewContext = createContext<Open>(() => {});

/** Opens the preview of a file in the workspace (its path inside the workspace). */
export const usePreview = () => useContext(PreviewContext);

export function PreviewProvider({ children }: { children: ReactNode }) {
  const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  return (
    <PreviewContext.Provider value={(path, name) => setFile({ path, name: name ?? (path.split("/").pop() ?? path) })}>
      {children}
      {file && <FilePreview path={file.path} name={file.name} onClose={() => setFile(null)} />}
    </PreviewContext.Provider>
  );
}
