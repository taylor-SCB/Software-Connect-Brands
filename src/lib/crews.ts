// Crews, the people on them, and time on a job.
//
// The whole module turns on one rule: money is counted once. Your own
// people cost you their hours, so their time lands in the job's Spent and
// Committed. A subcontractor bills you, so their money arrives as their
// purchase order and their hours are tracked for the schedule and for
// checking that bill — never added to the budget on top of the order.
//
// Rates are copied onto a time entry when it is logged, so raising a
// crew's rate tomorrow does not rewrite what last month cost.

import type { CrewKind } from "@/generated/prisma/enums";

export const CREW_KINDS = ["OWN", "SUBCONTRACTOR"] as const;

export const CREW_KIND_LABELS: Record<CrewKind, string> = {
  OWN: "Your own people",
  SUBCONTRACTOR: "Subcontractor",
};

// What each kind means for the budget, in the words shown on the form.
export const CREW_KIND_HINTS: Record<CrewKind, string> = {
  OWN: "Their hours are your cost, so the time you log goes straight on the job's budget.",
  SUBCONTRACTOR:
    "They bill you, so their money comes from their purchase order. Hours logged for them are tracked but not added to the budget on top of the order.",
};

export type Rates = { hourlyRateCents: number | null; dailyRateCents: number | null };

// Whose rate applies: the worker's own when they have one, else the
// crew's. Each rate falls back on its own, so a worker with a personal
// hourly rate still gets the crew's day rate.
export function ratesFor(worker: Rates | null | undefined, crew: Rates | null | undefined) {
  return {
    hourlyRateCents: worker?.hourlyRateCents ?? crew?.hourlyRateCents ?? 0,
    dailyRateCents: worker?.dailyRateCents ?? crew?.dailyRateCents ?? 0,
  };
}

// hours × hourly + days × daily, rounded once at the end. Both can be on
// the same row: three days plus four hours of overtime is one entry.
export function timeEntryAmountCents(input: {
  hours: number;
  days: number;
  hourlyRateCents: number;
  dailyRateCents: number;
}) {
  const hours = Number.isFinite(input.hours) ? Math.max(0, input.hours) : 0;
  const days = Number.isFinite(input.days) ? Math.max(0, input.days) : 0;
  return Math.round(hours * input.hourlyRateCents + days * input.dailyRateCents);
}

// Whether a crew's hours are a cost of their own. A subcontractor's are
// not, by default — but some subs work time-and-materials with no order
// behind them, so the log screen can turn it back on per entry.
export function costsByDefault(kind: CrewKind) {
  return kind !== "SUBCONTRACTOR";
}

// "3 days · 4 hrs", or just the half of it that is there. Never "0 hrs".
export function describeTime(entry: { hours: number; days: number }) {
  const parts: string[] = [];
  if (entry.days > 0) parts.push(`${trim(entry.days)} ${entry.days === 1 ? "day" : "days"}`);
  if (entry.hours > 0) parts.push(`${trim(entry.hours)} ${entry.hours === 1 ? "hr" : "hrs"}`);
  return parts.join(" · ") || "no time";
}

// 3 not 3.0, 3.5 stays 3.5.
function trim(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

// The rate as it reads on a row: "$45.00/hr · $520.00/day".
export function describeRates(rates: { hourlyRateCents: number; dailyRateCents: number }, format: (cents: number) => string) {
  const parts: string[] = [];
  if (rates.hourlyRateCents > 0) parts.push(`${format(rates.hourlyRateCents)}/hr`);
  if (rates.dailyRateCents > 0) parts.push(`${format(rates.dailyRateCents)}/day`);
  return parts.join(" · ") || "no rate set";
}

export type TimeTotals = {
  hours: number;
  days: number;
  costCents: number;
  paidCents: number;
  unpaidCents: number;
  // Hours logged for a subcontractor, which are tracked but are not the
  // job's cost. Shown separately so the number is never a surprise.
  trackedOnlyCents: number;
};

export function emptyTimeTotals(): TimeTotals {
  return { hours: 0, days: 0, costCents: 0, paidCents: 0, unpaidCents: 0, trackedOnlyCents: 0 };
}

export function sumTime(
  entries: { hours: number; days: number; amountCents: number; countsAsCost: boolean; paidOn: Date | null }[],
): TimeTotals {
  const totals = emptyTimeTotals();
  for (const entry of entries) {
    totals.hours += entry.hours;
    totals.days += entry.days;
    if (!entry.countsAsCost) {
      totals.trackedOnlyCents += entry.amountCents;
      continue;
    }
    totals.costCents += entry.amountCents;
    if (entry.paidOn) totals.paidCents += entry.amountCents;
    else totals.unpaidCents += entry.amountCents;
  }
  return totals;
}

// The one thing that can quietly double a job's cost: a subcontractor
// whose hours were switched on as a cost while their purchase order is
// also on the job. Worth a sentence on the screen, not a refusal — the
// user may be paying them both ways on purpose.
export function doubleCountWarning(input: {
  crewName: string;
  countedHoursCents: number;
  orderedCents: number;
}) {
  if (input.countedHoursCents <= 0 || input.orderedCents <= 0) return null;
  return `${input.crewName} has hours counted as a cost and a purchase order on this job. Check you are not paying them twice.`;
}
