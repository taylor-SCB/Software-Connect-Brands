import type { ReportKey } from "@/lib/reports/common";
import type { PeriodKey } from "@/lib/reports/period";
import { zonedParts } from "@/lib/reports/period";

// "Email me this" (Nov 10, 2026). A ReportSubscription sends one report to
// one teammate at 6am in the workspace's own time zone, on its cadence,
// covering the period just finished: Daily every morning (yesterday, or
// for the Daily Rundown, the day ahead), Weekly on Mondays (last week),
// Monthly on the 1st (last month), Quarterly on the 1st of Jan / Apr /
// Jul / Oct (last quarter), Yearly on Jan 1 (last year).

export const CADENCES = ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type Cadence = (typeof CADENCES)[number];

export const CADENCE_LABELS: Record<Cadence, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly, Mondays",
  MONTHLY: "Monthly, on the 1st",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly, Jan 1",
};

export function isCadence(value: unknown): value is Cadence {
  return typeof value === "string" && (CADENCES as readonly string[]).includes(value);
}

// The Daily Rundown is today's list, so it only makes sense every day.
export function cadencesFor(report: ReportKey): readonly Cadence[] {
  return report === "daily" ? ["DAILY"] : CADENCES;
}

// The period an email on this cadence covers.
export function periodForCadence(report: ReportKey, cadence: Cadence): PeriodKey {
  if (report === "daily") return "today";
  switch (cadence) {
    case "DAILY":
      return "yesterday";
    case "WEEKLY":
      return "last-week";
    case "MONTHLY":
      return "last-month";
    case "QUARTERLY":
      return "last-quarter";
    case "YEARLY":
      return "last-year";
  }
}

// Whether today, in the zone, is a day this cadence sends.
export function sendsOn(cadence: Cadence, now: Date, timeZone: string): boolean {
  const today = zonedParts(now, timeZone);
  switch (cadence) {
    case "DAILY":
      return true;
    case "WEEKLY":
      return today.weekday === 1;
    case "MONTHLY":
      return today.day === 1;
    case "QUARTERLY":
      return today.day === 1 && [1, 4, 7, 10].includes(today.month);
    case "YEARLY":
      return today.day === 1 && today.month === 1;
  }
}

// The hour, on the zone's clock, the emails go out.
export const SEND_HOUR = 6;
