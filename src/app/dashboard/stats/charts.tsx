"use client";

import { useRef, useState } from "react";
import { pct } from "@/lib/format";

// The Stats charts: plain SVG, one axis each, thin marks, a hover layer on
// every one, and every value also in a table on the page so nothing is
// only reachable by hovering. Colors are the four activity slots,
// validated for colour-blind separation against the app's dark surface
// (Sept 30, 2026): blue, orange, aqua, yellow, always in that order.

export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500"] as const;
const GRID = "rgb(255 255 255 / 0.07)";

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
            {row.color && <span className="inline-block h-[2px] w-3 rounded" style={{ background: row.color }} />}
            {row.label}
          </span>
          <strong className="num text-[var(--text)]">{row.value}</strong>
        </p>
      ))}
    </div>
  );
}

// Activity per rep: one horizontal stacked bar each, split by kind of
// touch, 2px surface gaps between segments, the total at the bar's end.
export function RepActivityBars({
  reps,
  series,
}: {
  reps: { name: string; values: number[] }[];
  series: string[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const max = Math.max(1, ...reps.map((rep) => rep.values.reduce((a, b) => a + b, 0)));
  const rowH = 30;
  const labelW = 132;
  const width = 640;
  const barW = width - labelW - 56;

  return (
    <div ref={box} className="relative" onPointerLeave={() => setTip(null)}>
      <Legend series={series} />
      <svg viewBox={`0 0 ${width} ${Math.max(1, reps.length) * rowH + 4}`} className="w-full" role="img" aria-label="Activity by rep">
        {reps.map((rep, index) => {
          const y = index * rowH + 6;
          const total = rep.values.reduce((a, b) => a + b, 0);
          let x = labelW;
          return (
            <g key={rep.name}>
              <text x={labelW - 10} y={y + 12} textAnchor="end" className="fill-[var(--text-dim)] text-[11px]">
                {rep.name.length > 18 ? `${rep.name.slice(0, 17)}…` : rep.name}
              </text>
              {rep.values.map((value, part) => {
                if (!value) return null;
                const w = Math.max(2, (value / max) * barW - 2);
                const rect = (
                  <rect
                    key={part}
                    x={x}
                    y={y}
                    width={w}
                    height={16}
                    rx={part === rep.values.length - 1 || rep.values.slice(part + 1).every((v) => !v) ? 4 : 0}
                    fill={SERIES_COLORS[part]}
                    className="cursor-default transition-opacity hover:opacity-80"
                    tabIndex={0}
                    onPointerMove={(event) => place(event.clientX, event.clientY, rep.name, part, value)}
                    onFocus={(event) => {
                      const r = (event.target as SVGRectElement).getBoundingClientRect();
                      place(r.left + r.width / 2, r.top, rep.name, part, value);
                    }}
                    onBlur={() => setTip(null)}
                  />
                );
                x += w + 2;
                return rect;
              })}
              <text x={labelW + (total / max) * barW + 8} y={y + 12} className="num fill-[var(--text)] text-[11px]">
                {total}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );

  function place(clientX: number, clientY: number, name: string, part: number, value: number) {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setTip({ x: clientX - r.left, y: clientY - r.top, title: name, rows: [{ label: series[part], value: String(value), color: SERIES_COLORS[part] }] });
  }
}

function Legend({ series }: { series: string[] }) {
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

// Team activity per day: one line, a soft area under it, and a crosshair
// that snaps to the nearest day and lists every kind of touch that day.
export function DailyTrend({
  days,
  series,
}: {
  days: { day: string; total: number; parts: number[] }[];
  series: string[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const height = 180;
  const pad = { l: 34, r: 10, t: 10, b: 22 };
  const max = Math.max(4, ...days.map((d) => d.total));
  const step = days.length > 1 ? (width - pad.l - pad.r) / (days.length - 1) : 0;
  const xAt = (i: number) => pad.l + i * step;
  const yAt = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const line = days.map((d, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(d.total).toFixed(1)}`).join(" ");
  const area = `${line} L${xAt(days.length - 1).toFixed(1)},${yAt(0)} L${xAt(0).toFixed(1)},${yAt(0)} Z`;
  const ticks = [0, Math.round(max / 2), max];
  const labelEvery = Math.max(1, Math.ceil(days.length / 6));
  const short = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  function onMove(event: React.PointerEvent<SVGSVGElement>) {
    const svg = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - svg.left) / svg.width) * width;
    const index = Math.round((x - pad.l) / (step || 1));
    setHover(Math.min(days.length - 1, Math.max(0, index)));
  }

  const h = hover === null ? null : days[hover];
  // Placed in percentages of the chart, which scales with its box.
  const tipX = hover === null ? "0%" : `${(xAt(hover) / width) * 100}%`;
  const tipY = h ? `${(yAt(h.total) / height) * 100}%` : "0%";

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none"
        role="img"
        aria-label="Team activity per day"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={SERIES_COLORS[0]} stopOpacity="0.28" />
            <stop offset="100%" stopColor={SERIES_COLORS[0]} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.l} x2={width - pad.r} y1={yAt(tick)} y2={yAt(tick)} stroke={GRID} />
            <text x={pad.l - 6} y={yAt(tick) + 3} textAnchor="end" className="num fill-[var(--text-faint)] text-[10px]">
              {tick}
            </text>
          </g>
        ))}
        {days.map((d, i) =>
          i % labelEvery === 0 || i === days.length - 1 ? (
            <text key={d.day} x={xAt(i)} y={height - 6} textAnchor="middle" className="fill-[var(--text-faint)] text-[10px]">
              {short(d.day)}
            </text>
          ) : null,
        )}
        <path d={area} fill="url(#trend-fill)" />
        <path d={line} fill="none" stroke={SERIES_COLORS[0]} strokeWidth={2} strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 6px ${SERIES_COLORS[0]}66)` }} />
        {h && hover !== null && (
          <g>
            <line x1={xAt(hover)} x2={xAt(hover)} y1={pad.t} y2={height - pad.b} stroke="rgb(255 255 255 / 0.25)" />
            <circle cx={xAt(hover)} cy={yAt(h.total)} r={4.5} fill={SERIES_COLORS[0]} stroke="#0b0d13" strokeWidth={2} />
          </g>
        )}
      </svg>
      {h && (
        <Tooltip
          tip={{
            x: tipX,
            y: tipY,
            title: short(h.day),
            rows: [{ label: "All touches", value: String(h.total), color: SERIES_COLORS[0] }, ...series.map((name, i) => ({ label: name, value: String(h.parts[i]) }))],
          }}
        />
      )}
    </div>
  );
}

// The funnel: one bar per step, one colour (it is one series), the count
// at the end and the step-to-step conversion between them.
export function FunnelBars({ steps }: { steps: { label: string; value: number; rate: number | null; from: string | null }[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>(null);
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div ref={box} className="relative space-y-1.5" onPointerLeave={() => setTip(null)} data-testid="stats-funnel">
      {steps.map((step) => (
        <div key={step.label} className="grid grid-cols-[8.5rem_1fr_3rem] items-center gap-2 text-xs">
          <span className="truncate text-[var(--text-dim)]">{step.label}</span>
          <div className="relative h-5 rounded bg-[rgb(255_255_255/0.03)]">
            <div
              className="absolute inset-y-0 left-0 rounded"
              style={{
                width: `${Math.max(step.value ? 2 : 0, (step.value / max) * 100)}%`,
                background: `linear-gradient(90deg, ${SERIES_COLORS[0]}cc, ${SERIES_COLORS[0]})`,
                boxShadow: `0 0 12px ${SERIES_COLORS[0]}55`,
              }}
              tabIndex={0}
              onPointerMove={(event) => {
                const r = box.current?.getBoundingClientRect();
                if (!r) return;
                setTip({
                  x: event.clientX - r.left,
                  y: event.clientY - r.top,
                  title: step.label,
                  rows: [
                    { label: "People", value: String(step.value) },
                    ...(step.from && step.rate !== null ? [{ label: `from ${step.from}`, value: pct(step.rate) }] : []),
                  ],
                });
              }}
            />
          </div>
          <span className="num text-right font-medium" data-testid="funnel-count">
            {step.value}
          </span>
          {step.from && step.rate !== null && (
            <span className="faint col-start-2 -mt-1 text-[0.62rem]">↳ {pct(step.rate)} from {step.from}</span>
          )}
        </div>
      ))}
      <Tooltip tip={tip} />
    </div>
  );
}

// Days between hand-offs: one bar each, one colour, the number at the end.
export function VelocityBars({ rows }: { rows: { label: string; days: number | null; samples: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.days ?? 0));
  return (
    <div className="space-y-2" data-testid="stats-velocity">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[11rem_1fr_4.5rem] items-center gap-2 text-xs" title={`${row.samples} ${row.samples === 1 ? "person" : "people"} measured`}>
          <span className="truncate text-[var(--text-dim)]">{row.label}</span>
          <div className="h-2 rounded bg-[rgb(255_255_255/0.03)]">
            {row.days !== null && (
              <div className="h-2 rounded" style={{ width: `${Math.max(2, (row.days / max) * 100)}%`, background: SERIES_COLORS[2], boxShadow: `0 0 10px ${SERIES_COLORS[2]}55` }} />
            )}
          </div>
          <span className="num text-right">{row.days === null ? <span className="faint">—</span> : `${row.days.toFixed(1)} d`}</span>
        </div>
      ))}
    </div>
  );
}

