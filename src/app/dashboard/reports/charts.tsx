"use client";

import { useRef, useState } from "react";
import { SERIES_COLORS } from "@/app/dashboard/stats/charts";

// The report charts (Nov 10, 2026), in the Stats charts' system: plain SVG
// and HTML, thin marks with 2px gaps between segments, one axis, the four
// validated series colours in fixed order (blue, orange, aqua, yellow —
// colour follows the series, never its rank), a legend whenever there is
// more than one series, a hover / focus tooltip on every mark, and every
// value also in the table under the chart so nothing is only reachable by
// hovering.

type Format = "money" | "count";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
function show(value: number, format: Format) {
  return format === "money" ? dollars.format(Math.round(value / 100)) : value.toLocaleString("en-US");
}
// Short axis / end labels: $12k, $1.2M.
function compact(value: number, format: Format) {
  const n = format === "money" ? value / 100 : value;
  const abs = Math.abs(n);
  const text = abs >= 1_000_000 ? `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M` : abs >= 10_000 ? `${Math.round(n / 1000)}k` : abs >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
  return format === "money" ? `$${text}` : text;
}

type Tip = { x: number | string; y: number | string; title: string; rows: { label: string; value: string; color?: string }[] } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div
      className="popover pointer-events-none absolute z-20 min-w-[9rem] rounded-lg border border-[var(--border-strong)] px-3 py-2 text-xs shadow-xl"
      style={{ left: tip.x, top: tip.y, transform: "translate(-50%, calc(-100% - 10px))" }}
      role="status"
    >
      <p className="faint mb-1 text-[0.68rem]">{tip.title}</p>
      {tip.rows.map((row) => (
        <p key={row.label} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-[var(--text-dim)]">
            {row.color && <span className="inline-block h-2 w-2 rounded-sm" style={{ background: row.color }} />}
            {row.label}
          </span>
          <strong className="num text-[var(--text)]">{row.value}</strong>
        </p>
      ))}
    </div>
  );
}

export function Legend({ series }: { series: string[] }) {
  if (series.length < 2) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-3 text-[0.7rem] text-[var(--text-dim)]">
      {series.map((name, index) => (
        <span key={name} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_COLORS[index] }} />
          {name}
        </span>
      ))}
    </div>
  );
}

// One horizontal bar per row, split into its series, the total at the end.
export function HBars({
  rows,
  series,
  format,
  label,
  testId,
}: {
  rows: { label: string; values: number[]; note?: string }[];
  series: string[];
  format: Format;
  label: string;
  testId?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const max = Math.max(1, ...rows.map((row) => row.values.reduce((a, b) => a + Math.max(0, b), 0)));
  if (rows.length === 0) return <p className="faint text-sm">Nothing to show for this period.</p>;

  function place(target: Element, title: string, index: number, value: number, clientX?: number, clientY?: number) {
    const outer = box.current?.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    if (!outer) return;
    setTip({
      x: (clientX ?? rect.left + rect.width / 2) - outer.left,
      y: (clientY ?? rect.top) - outer.top,
      title,
      rows: [{ label: series[index], value: show(value, format), color: series.length > 1 ? SERIES_COLORS[index] : undefined }],
    });
  }

  return (
    <div ref={box} className="relative" onPointerLeave={() => setTip(null)} data-testid={testId} role="img" aria-label={label}>
      <Legend series={series} />
      <div className="space-y-1.5">
        {rows.map((row) => {
          const total = row.values.reduce((a, b) => a + Math.max(0, b), 0);
          return (
            <div key={row.label} className="grid grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-2 text-xs sm:grid-cols-[minmax(0,11rem)_1fr_auto]">
              <span className="truncate text-[var(--text-dim)]" title={row.label}>
                {row.label}
              </span>
              <div className="flex h-4 min-w-0 gap-[2px]">
                {row.values.map((value, index) => {
                  if (value <= 0) return null;
                  const width = (value / max) * 100;
                  return (
                    <div
                      key={index}
                      className="h-full first:rounded-l-[4px] last:rounded-r-[4px] hover:opacity-80"
                      style={{ width: `${Math.max(0.8, width)}%`, background: SERIES_COLORS[index] }}
                      tabIndex={0}
                      aria-label={`${row.label}, ${series[index]}: ${show(value, format)}`}
                      onPointerMove={(event) => place(event.currentTarget, row.label, index, value, event.clientX, event.clientY)}
                      onFocus={(event) => place(event.currentTarget, row.label, index, value)}
                      onBlur={() => setTip(null)}
                    />
                  );
                })}
              </div>
              <span className="num whitespace-nowrap text-right text-[var(--text)]">
                {compact(total, format)}
                {row.note && <span className="faint ml-1.5">{row.note}</span>}
              </span>
            </div>
          );
        })}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

// Columns over time (days or weeks), stacked by series, with a crosshair
// that lists every series for the column under the pointer.
export function Columns({
  buckets,
  series,
  format,
  label,
  bucketWord = "day",
  testId,
}: {
  buckets: { label: string; parts: number[] }[];
  series: string[];
  format: Format;
  label: string;
  bucketWord?: "day" | "week";
  testId?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const height = 170;
  const pad = { l: 34, r: 8, t: 10, b: 22 };
  const totals = buckets.map((bucket) => bucket.parts.reduce((a, b) => a + b, 0));
  const max = Math.max(format === "count" ? 4 : 100, ...totals);
  const plotW = width - pad.l - pad.r;
  const slot = buckets.length ? plotW / buckets.length : plotW;
  const barW = Math.max(2, Math.min(28, slot - 2));
  const yAt = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 7));
  const pretty = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  function onMove(event: React.PointerEvent<SVGSVGElement>) {
    const svg = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - svg.left) / svg.width) * width;
    const index = Math.floor((x - pad.l) / slot);
    setHover(index >= 0 && index < buckets.length ? index : null);
  }
  const h = hover === null ? null : buckets[hover];

  return (
    <div className="relative" data-testid={testId}>
      <Legend series={series} />
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full touch-none" role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.l} x2={width - pad.r} y1={yAt(tick)} y2={yAt(tick)} stroke="var(--border)" />
            <text x={pad.l - 6} y={yAt(tick) + 3} textAnchor="end" className="num fill-[var(--text-faint)] text-[10px]">
              {compact(tick, format)}
            </text>
          </g>
        ))}
        {buckets.map((bucket, i) => {
          const x = pad.l + i * slot + (slot - barW) / 2;
          let y = yAt(0);
          return (
            <g key={bucket.label} opacity={hover === null || hover === i ? 1 : 0.55}>
              {bucket.parts.map((value, part) => {
                if (value <= 0) return null;
                const segment = yAt(0) - yAt(value);
                const top = y - segment;
                const isTop = bucket.parts.slice(part + 1).every((v) => v <= 0);
                y = top - 2;
                return (
                  <rect
                    key={part}
                    x={x}
                    y={top}
                    width={barW}
                    height={Math.max(1, segment)}
                    rx={isTop ? Math.min(4, barW / 2) : 0}
                    fill={SERIES_COLORS[part]}
                  />
                );
              })}
              {(i % labelEvery === 0 || i === buckets.length - 1) && (
                <text x={x + barW / 2} y={height - 6} textAnchor="middle" className="fill-[var(--text-faint)] text-[10px]">
                  {pretty(bucket.label)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <Tooltip
          tip={{
            x: `${((pad.l + hover * slot + slot / 2) / width) * 100}%`,
            y: `${(yAt(totals[hover]) / height) * 100}%`,
            title: `${bucketWord === "week" ? "Week of " : ""}${pretty(h.label)}`,
            rows: [
              ...(series.length > 1 ? [{ label: "All", value: show(totals[hover], format) }] : []),
              ...series.map((name, index) => ({ label: name, value: show(h.parts[index] ?? 0, format), color: series.length > 1 ? SERIES_COLORS[index] : undefined })),
            ],
          }}
        />
      )}
    </div>
  );
}
