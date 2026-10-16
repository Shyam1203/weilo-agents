const format = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export type Points = { label: string; value: number }[];

export function Bars({ points }: { points: Points }) {
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

export function Line({ points }: { points: Points }) {
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
