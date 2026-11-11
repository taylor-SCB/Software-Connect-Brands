import Link from "next/link";
import { ringFill } from "@/lib/up-next";

// A week ring (BDR redesign, Nov 11, 2026): the number in the middle, the
// name under it and "of 60" or "+3 vs last week" under that. The arc is
// the brand colour (it is progress, not health). No hooks, so it renders
// on the server. Words carry the meaning; the arc only repeats it.
export function Ring({
  label,
  value,
  goal,
  lastWeek,
  href,
  size = 64,
  testId,
}: {
  label: string;
  value: number;
  goal: number | null;
  lastWeek: number;
  href?: string;
  size?: number;
  testId?: string;
}) {
  const ring = ringFill(value, goal, lastWeek);
  const stroke = size >= 56 ? 6 : 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const body = (
    <>
      <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="absolute inset-0 -rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--hairline-2)" strokeWidth={stroke} />
          {ring.fill > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="var(--brand)"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${c * ring.fill} ${c}`}
            />
          )}
        </svg>
        <span className="num relative text-base font-semibold" data-testid="ring-value">
          {value}
        </span>
      </span>
      <span className="min-w-0 text-center">
        <span className="block text-xs font-medium">{label}</span>
        <span className="faint block text-[0.7rem]" data-testid="ring-caption">
          {ring.caption}
        </span>
      </span>
    </>
  );
  const className = "flex min-w-0 flex-col items-center gap-1.5 rounded-xl p-1 text-[var(--text)]";
  return href ? (
    <Link href={href} className={`${className} hover:bg-[var(--hover)]`} data-testid={testId} aria-label={`${label}: ${value}, ${ring.caption}`}>
      {body}
    </Link>
  ) : (
    <div className={className} data-testid={testId}>
      {body}
    </div>
  );
}
