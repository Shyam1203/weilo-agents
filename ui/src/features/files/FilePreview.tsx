// A file an agent made, shown in the app: a picture, a PDF, a Markdown, CSV, JSON, HTML or text file, without a download.
// Anything else (a Word or Excel file) has no preview here and downloads.
import { useEffect, useState } from "react";
import { fileUrl } from "../../api/chat";
import { messageOf } from "../../api/http";
import { Button } from "../../components/ui/Button";
import { Loading } from "../../components/ui/List";
import { Modal } from "../../components/ui/Modal";
import { Markdown } from "../../components/Markdown";
import { ShowPage } from "../chat/ShowPage";
import { kindOf, parseTable, type Kind } from "./kinds";

/** Larger files show their start only (characters of text), and at most this many rows of a table. */
const MAX_TEXT = 1_000_000;
const MAX_ROWS = 300;

/** Shown for a file that was moved or deleted after the reply named it. */
const GONE = "This file is no longer there. The agent may have moved or deleted it.";

const TEXT_KINDS: Kind[] = ["markdown", "csv", "json", "html", "text"];

export function FilePreview({ path, name, onClose }: { path: string; name: string; onClose: () => void }) {
  const kind = kindOf(path);
  const url = fileUrl(path, true);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!TEXT_KINDS.includes(kind)) return;
    let current = true;
    fetch(url).then(
      async (res) => (res.ok ? startOf(res) : Promise.reject(new Error(GONE))),
    ).then(
      (t) => current && setText(t),
      (err) => current && setError(messageOf(err)),
    );
    return () => {
      current = false;
    };
  }, [url, kind]);

  const cut = text !== null && text.length > MAX_TEXT;
  const shown = text === null ? "" : cut ? text.slice(0, MAX_TEXT) : text;

  return (
    <Modal title={name} onClose={onClose} width="max-w-4xl">
      <div className="flex flex-col gap-3">
        {/* A file that is gone cannot be opened or downloaded either: only the message shows. */}
        {!error && (
          <div className="flex items-center justify-end gap-2">
            {kind !== "other" && (
              <a href={url} target="_blank" rel="noreferrer noopener">
                <Button size="sm" icon="external">
                  Open in a new tab
                </Button>
              </a>
            )}
            <a href={fileUrl(path)} download={name}>
              <Button size="sm" icon="download">
                Download
              </Button>
            </a>
          </div>
        )}
        {error ? (
          <p role="alert" className="rounded-lg bg-card px-3 py-2.5 text-[13.5px] text-ink-2">{error}</p>
        ) : kind === "image" ? (
          <img src={fileUrl(path)} alt={name} onError={() => setError(GONE)} className="mx-auto max-h-[calc(70dvh/var(--zoom))] max-w-full rounded-lg object-contain" />
        ) : kind === "pdf" ? (
          <object data={url} type="application/pdf" className="h-[calc(70dvh/var(--zoom))] w-full rounded-lg border border-line">
            <p className="p-4 text-[13.5px] text-ink-2">This browser cannot show a PDF here. Open it in a new tab, or download it.</p>
          </object>
        ) : kind === "other" ? (
          <p className="text-[13.5px] text-ink-2">There is no preview for this kind of file here. Download it to open it.</p>
        ) : text === null ? (
          <Loading />
        ) : kind === "markdown" ? (
          <div className="prose-chat">
            <Markdown text={shown} />
          </div>
        ) : kind === "csv" ? (
          <Table text={shown} separator={path.toLowerCase().endsWith(".tsv") ? "\t" : ","} />
        ) : kind === "html" ? (
          <ShowPage title="" html={shown} />
        ) : (
          <pre className="max-h-[calc(70dvh/var(--zoom))] overflow-auto rounded-lg bg-card p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{kind === "json" ? pretty(shown) : shown}</pre>
        )}
        {cut && <p className="hint">Only the start of this file is shown. Download it to see all of it.</p>}
      </div>
    </Modal>
  );
}

// The start of a response's text: a huge file is not read to its end.
async function startOf(res: Response) {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (text.length <= MAX_TEXT) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  void reader.cancel();
  return text;
}

// JSON laid out with indentation, or as it is when it does not parse.
function pretty(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function Table({ text, separator }: { text: string; separator: string }) {
  const rows = parseTable(text, separator);
  if (!rows.length) return <p className="text-[13.5px] text-ink-2">The file is empty.</p>;
  const [head, ...body] = rows;
  return (
    <div className="max-h-[calc(70dvh/var(--zoom))] overflow-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-left text-[13px]">
        <thead className="sticky top-0 bg-card">
          <tr>
            {head.map((c, i) => (
              <th key={i} className="border-b border-line px-3 py-2 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.slice(0, MAX_ROWS).map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-1.5 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {body.length > MAX_ROWS && <p className="hint px-3 py-2">The first {MAX_ROWS} of {body.length} rows.</p>}
    </div>
  );
}
