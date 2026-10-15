import { useState, type ReactNode } from "react";
import { Icon } from "../../components/ui/Icon";
import { kindOf } from "../files/kinds";
import { useFileUrl, usePreview } from "../files/PreviewContext";
import { AgentText, CardText } from "./AgentText";
import type { Block } from "./blockData";
import { PickButton } from "./PickButton";
import { ShowPage } from "./ShowPage";

const CARD = "rounded-2xl border border-line bg-page";

interface Props {
  blocks: Block[];
  onReply?: (message: string) => void;
  chosen?: string;
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

export function ShowBlocks({ blocks, onReply, chosen }: Props) {
  return (
    <div className="flex max-w-full flex-col gap-2">
      {blocks.map((block, i) => (
        <One key={i} block={block} onReply={onReply} chosen={chosen} />
      ))}
    </div>
  );
}

function One({ block, onReply, chosen }: Omit<Props, "blocks"> & { block: Block }) {
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
      return <File path={block.path} name={block.name} />;
    case "page":
      return <ShowPage title={block.title} html={block.html} onReply={onReply} />;
  }
}

function Choice({ label, done, message, chosen, onReply }: { label: string; done?: string; message: string; chosen?: string; onReply?: (message: string) => void }) {
  return <PickButton label={label} done={done} picked={chosen === message} onPick={onReply && (() => onReply(message))} />;
}

function File({ path, name }: { path: string; name: string }) {
  const url = useFileUrl()(path);
  const preview = usePreview();
  const kind = kindOf(path);
  return (
    <div className={`${CARD} max-w-sm overflow-hidden`}>
      {kind === "image" && (
        <button type="button" onClick={() => preview(path, name)} aria-label={`Preview ${name}`} className="block w-full">
          <img src={url} alt={name} className="max-h-72 w-full object-contain" />
        </button>
      )}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <Icon name="attach" size={15} className="shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1 truncate text-[13.5px]">{name}</span>
        {kind !== "other" && kind !== "image" && (
          <button type="button" onClick={() => preview(path, name)} className="shrink-0 text-[13px] font-medium underline underline-offset-2">
            Preview
          </button>
        )}
        <a href={url} download={name} className="shrink-0 text-[13px] font-medium underline underline-offset-2">
          Download
        </a>
      </div>
    </div>
  );
}

function Titled({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={`${CARD} max-w-full overflow-hidden`}>
      {title && <h3 className="px-3.5 pt-3 pb-1 text-[13.5px] font-medium">{title}</h3>}
      {children}
    </section>
  );
}

const format = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

type Points = { label: string; value: number }[];

function Bars({ points }: { points: Points }) {
  const low = Math.min(0, ...points.map((p) => p.value));
  const span = Math.max(...points.map((p) => p.value)) - low || 1;
  return (
    <ul className="flex flex-col gap-2 pt-2">
      {points.map((p, i) => (
        <li key={i} className="grid grid-cols-[minmax(4rem,25%)_1fr_auto] items-center gap-2.5 text-[13px]">
          <span className="truncate text-ink-2">{p.label}</span>
          <span className="h-2.5 rounded-full bg-select">
            <span className="block h-full rounded-full bg-ink" style={{ width: `${Math.max(((p.value - low) / span) * 100, 1)}%` }} />
          </span>
          <span className="tabular-nums">{format(p.value)}</span>
        </li>
      ))}
    </ul>
  );
}

const W = 320;
const H = 120;
const PAD = 8;

function Line({ points }: { points: Points }) {
  const values = points.map((p) => p.value);
  const low = Math.min(...values);
  const span = Math.max(...values) - low || 1;
  const at = (p: Points[number], i: number) => [PAD + (points.length < 2 ? (W - 2 * PAD) / 2 : (i / (points.length - 1)) * (W - 2 * PAD)), H - PAD - ((p.value - low) / span) * (H - 2 * PAD)] as const;
  const dots = points.map(at);
  return (
    <figure className="pt-2">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={points.map((p) => `${p.label} ${format(p.value)}`).join(", ")} className="w-full text-ink">
        <polyline points={dots.map((d) => d.join(",")).join(" ")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {dots.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3" fill="currentColor" />
        ))}
      </svg>
      <figcaption className="mt-1 flex justify-between gap-2 text-xs text-ink-3">
        <span className="truncate">{points[0].label}</span>
        <span className="tabular-nums">
          {format(low)} – {format(Math.max(...values))}
        </span>
        <span className="truncate">{points.at(-1)!.label}</span>
      </figcaption>
    </figure>
  );
}
