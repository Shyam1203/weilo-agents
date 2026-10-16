import { useEffect, useState } from "react";
import type { Agent } from "../../api/agents";
import { messageOf } from "../../api/http";
import { getUsage, type UsageDay } from "../../api/usage";
import { ErrorText } from "../../components/ui/Field";
import { Loading } from "../../components/ui/List";
import { Card, Page, Row } from "../../components/ui/Row";

const SERIES = 8;
const OTHER = "other";
const W = 640;
const H = 200;
const PAD = { top: 8, right: 8, bottom: 22, left: 44 };

const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const dollars = (n: number) => (n ? `$${n < 10 ? n.toFixed(2) : Math.round(n)}` : "-");
const dayLabel = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
const colorOf = (i: number) => (i < SERIES ? `var(--series-${i + 1})` : "var(--color-ink-3)");

function niceMax(max: number) {
  const step = 10 ** Math.floor(Math.log10(max || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * step).find((n) => n >= max) ?? max;
}

export function UsagePage({ agents }: { agents: Agent[] }) {
  const [days, setDays] = useState<UsageDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => void getUsage().then(setDays, (e) => setError(messageOf(e))), []);
  if (!days) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  const shown = agents.slice(0, SERIES - 1 + Number(agents.length === SERIES));
  const seriesOf = (id: string) => (shown.some((a) => a.id === id) ? id : OTHER);
  const keys = [...shown.map((a) => a.id), ...(agents.length > shown.length || days.some((d) => Object.keys(d.agents).some((id) => seriesOf(id) === OTHER)) ? [OTHER] : [])];
  const nameOf = (key: string) => agents.find((a) => a.id === key)?.name ?? "Other";
  const stacks = days.map((d) => {
    const by: Record<string, number> = {};
    for (const [id, used] of Object.entries(d.agents)) by[seriesOf(id)] = (by[seriesOf(id)] ?? 0) + used.tokens;
    return { day: d.day, by, total: Object.values(by).reduce((a, b) => a + b, 0) };
  });
  const totals = (list: UsageDay[]) => {
    const sum: Record<string, { tokens: number; cost: number }> = {};
    for (const d of list) for (const [id, used] of Object.entries(d.agents)) sum[id] = { tokens: (sum[id]?.tokens ?? 0) + used.tokens, cost: (sum[id]?.cost ?? 0) + used.cost };
    return sum;
  };
  const range = totals(days);
  const today = totals(days.slice(-1));
  const all = Object.values(range);
  const [rangeTokens, rangeCost] = [all.reduce((a, u) => a + u.tokens, 0), all.reduce((a, u) => a + u.cost, 0)];
  const todayTokens = Object.values(today).reduce((a, u) => a + u.tokens, 0);

  const max = niceMax(Math.max(...stacks.map((s) => s.total), 1));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / stacks.length;
  const barW = Math.max(4, slot - 6);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const active = hover === null ? null : stacks[hover];

  return (
    <Page title="Usage" description={`Use in the last ${days.length} days. Cost is an estimate.`}>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Today" value={tokens(todayTokens)} />
        <Stat label={`Last ${days.length} days`} value={tokens(rangeTokens)} />
        <Stat label="Estimated cost" value={dollars(rangeCost)} />
      </div>
      <figure className="flex flex-col gap-2 rounded-xl px-4 py-3 ring-1 ring-line ring-inset">
        <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
          <span className="font-medium text-ink">Tokens a day</span>
          {keys.length > 1 &&
            keys.map((key, i) => (
              <span key={key} className="flex items-center gap-1.5">
                <i className="inline-block size-2.5 rounded-sm" style={{ background: colorOf(key === OTHER ? SERIES : i) }} />
                {nameOf(key)}
              </span>
            ))}
        </figcaption>
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Tokens a day by agent, last ${days.length} days`} onMouseLeave={() => setHover(null)}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(max * f)} y2={y(max * f)} className="stroke-line-strong" strokeWidth={1} />
                <text x={PAD.left - 6} y={y(max * f) + 4} textAnchor="end" className="fill-ink-3 text-[10px]">
                  {tokens(max * f)}
                </text>
              </g>
            ))}
            {stacks.map((s, i) => {
              let top = s.total;
              const x = PAD.left + i * slot + (slot - barW) / 2;
              return (
                <g key={s.day} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${dayLabel(s.day)}: ${tokens(s.total)} tokens`}>
                  <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" />
                  {keys.map((key, k) => {
                    const v = s.by[key] ?? 0;
                    if (!v) return null;
                    const h = Math.max(1, (v / max) * plotH - 2);
                    const bar = <rect key={key} x={x} y={y(top)} width={barW} height={h} rx={top === s.total ? 3 : 0} fill={colorOf(key === OTHER ? SERIES : k)} opacity={hover === null || hover === i ? 1 : 0.45} />;
                    top -= v;
                    return bar;
                  })}
                  {(stacks.length - 1 - i) % Math.ceil(stacks.length / 7) === 0 && (
                    <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="fill-ink-3 text-[10px]">
                      {dayLabel(s.day)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {active && active.total > 0 && (
            <div className="pointer-events-none absolute top-1 rounded-lg bg-raised px-3 py-2 text-xs shadow-pop ring-1 ring-line" style={{ left: `${Math.min(70, (hover! / stacks.length) * 100)}%` }}>
              <p className="font-medium text-ink">
                {dayLabel(active.day)} · {tokens(active.total)}
              </p>
              {keys
                .filter((key) => active.by[key])
                .map((key) => (
                  <p key={key} className="flex items-center gap-1.5 text-ink-2">
                    <i className="inline-block size-2 rounded-sm" style={{ background: colorOf(key === OTHER ? SERIES : keys.indexOf(key)) }} />
                    {nameOf(key)}: {tokens(active.by[key])}
                  </p>
                ))}
            </div>
          )}
        </div>
      </figure>
      <Card>
        {agents.map((a) => (
          <Row
            key={a.id}
            title={a.name}
            description={`Today ${tokens(today[a.id]?.tokens ?? 0)}${a.dailyTokens ? ` of ${tokens(a.dailyTokens)} a day` : ", no daily limit"} · ${days.length} days ${tokens(range[a.id]?.tokens ?? 0)}`}
          >
            <span className="text-[13px] text-ink-2 tabular-nums">{dollars(range[a.id]?.cost ?? 0)}</span>
          </Row>
        ))}
      </Card>
    </Page>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl px-4 py-3 ring-1 ring-line ring-inset">
    <p className="text-xs text-ink-3">{label}</p>
    <p className="mt-0.5 text-[20px] font-semibold tracking-tight tabular-nums">{value}</p>
  </div>
);
