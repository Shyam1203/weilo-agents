import { lazy, Suspense, useState, type ReactNode } from "react";
import { AgentText, CardText } from "./AgentText";
import { Bars, Line } from "./Charts";
import { FileCard } from "./FileCard";
import type { Block } from "./blockData";
import { PickButton } from "./PickButton";
import { ShowPage } from "./ShowPage";

const OpenUIBlock = lazy(() => import("./openui/OpenUIBlock"));

const CARD = "rounded-2xl border border-line bg-page";

interface Props {
  blocks: Block[];
  onReply?: (message: string) => void;
  chosen?: string;
  streaming?: boolean;
}

function CardImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className="flex h-36 items-center justify-center bg-white p-3">
      <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="max-h-full max-w-full object-contain" />
    </div>
  );
}

export function ShowBlocks({ blocks, onReply, chosen, streaming }: Props) {
  return (
    <div className="flex max-w-full flex-col gap-2">
      {blocks.map((block, i) => (
        <One key={i} block={block} onReply={onReply} chosen={chosen} streaming={streaming} />
      ))}
    </div>
  );
}

function One({ block, onReply, chosen, streaming = false }: Omit<Props, "blocks"> & { block: Block }) {
  switch (block.type) {
    case "text":
      return <AgentText text={block.text} />;
    case "table":
      return (
        <Titled title={block.title}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13.5px]">
              <thead>
                <tr>
                  {block.columns.map((c, i) => (
                    <th key={i} className="px-3.5 py-2 text-xs font-medium whitespace-nowrap text-ink-3">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r} className="border-t border-line">
                    {block.columns.map((_, c) => (
                      <td key={c} className="px-3.5 py-2 align-top">
                        {row[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Titled>
      );
    case "metrics":
      return (
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
          {block.items.map((m, i) => (
            <li key={i} className={`${CARD} px-3.5 py-3`}>
              <p className="text-xs text-ink-3">{m.label}</p>
              <p className="mt-0.5 text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">{m.value}</p>
              {m.note && <p className="mt-0.5 text-xs text-ink-2">{m.note}</p>}
            </li>
          ))}
        </ul>
      );
    case "cards":
      return (
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-2">
          {block.items.map((c, i) => (
            <li key={i} className={`${CARD} flex flex-col overflow-hidden ${c.message && c.message === chosen ? "border-ink ring-1 ring-ink" : ""}`}>
              {c.image && <CardImage src={c.image} />}
              <div className="flex flex-1 flex-col px-3.5 py-3">
              <p className="text-[14.5px] font-medium [overflow-wrap:anywhere]">{c.title}</p>
              {c.text && <div className="mt-1"><CardText text={c.text} /></div>}
              {(c.message || c.link) && (
                <div className="mt-auto flex items-center gap-3 pt-3">
                  {c.message && <Choice label="Choose" done="Chosen" message={c.message} chosen={chosen} onReply={onReply} />}
                  {c.link && (
                    <a href={c.link} target="_blank" rel="noreferrer noopener" className="text-[13px] font-medium underline underline-offset-2">
                      Open
                    </a>
                  )}
                </div>
              )}
              </div>
            </li>
          ))}
        </ul>
      );
    case "chart":
      return (
        <Titled title={block.title}>
          <div className="px-3.5 pb-3">{block.shape === "line" ? <Line points={block.points} /> : <Bars points={block.points} />}</div>
        </Titled>
      );
    case "buttons":
      return (
        <div className="flex flex-wrap gap-2">
          {block.options.map((o, i) => (
            <Choice key={i} label={o.label} message={o.message} chosen={chosen} onReply={onReply} />
          ))}
        </div>
      );
    case "file":
      return <FileCard path={block.path} name={block.name} />;
    case "openui":
      return (
        <Suspense fallback={null}>
          <OpenUIBlock source={block.source} streaming={streaming} onReply={onReply} />
        </Suspense>
      );
    case "page":
      return <ShowPage title={block.title} html={block.html} onReply={onReply} />;
  }
}

function Choice({ label, done, message, chosen, onReply }: { label: string; done?: string; message: string; chosen?: string; onReply?: (message: string) => void }) {
  return <PickButton label={label} done={done} picked={chosen === message} onPick={onReply && (() => onReply(message))} />;
}

function Titled({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${CARD} max-w-full overflow-hidden`}>
      {title && <h3 className="px-3.5 pt-3 pb-1 text-[13.5px] font-medium">{title}</h3>}
      {children}
    </section>
  );
}
