import {
  BREAKDOWN_KEYS,
  DEFAULT_PERIOD,
  isBreakdownKey,
  isReportKey,
  REPORT_BREAKDOWNS,
  type BreakdownKey,
  type ReportKey,
  type ReportParams,
} from "@/lib/reports/common";
import { isPeriodKey, periodRange, type PeriodKey } from "@/lib/reports/period";
import { loadDaily, type DailyReport } from "@/lib/reports/daily";
import { loadPipeline, type PipelineReport } from "@/lib/reports/pipeline";
import { loadActivity, type ActivityReport } from "@/lib/reports/activity";
import { loadClosing, type ClosingReport } from "@/lib/reports/closing";
import { loadMoney, type MoneyReport } from "@/lib/reports/money";

// One door into the five reports, for the Overview page, the write-up and
// the 6am email: the same choices in, the same numbers out.

export type AnyReport = DailyReport | PipelineReport | ActivityReport | ClosingReport | MoneyReport;

export type ReportChoice = {
  report: ReportKey;
  period: PeriodKey;
  // null is the whole team.
  repId: string | null;
  by: BreakdownKey;
};

// What the address bar asked for, with anything unknown falling back to the
// report's own default. A rep who isn't on this workspace reads as the
// whole team rather than an empty report.
export function readChoice(
  params: { report?: string; period?: string; rep?: string; by?: string },
  teamIds: string[],
): ReportChoice {
  const report: ReportKey = isReportKey(params.report) ? params.report : "daily";
  const period: PeriodKey = report === "daily" ? "today" : isPeriodKey(params.period) ? params.period : DEFAULT_PERIOD[report];
  const repId = params.rep && teamIds.includes(params.rep) ? params.rep : null;
  const offered = REPORT_BREAKDOWNS[report];
  const by: BreakdownKey = isBreakdownKey(params.by) && offered.includes(params.by) ? params.by : (offered[0] ?? BREAKDOWN_KEYS[0]);
  return { report, period, repId, by };
}

export function reportHref(choice: ReportChoice, path = "/dashboard") {
  const search = new URLSearchParams();
  if (choice.report !== "daily") search.set("report", choice.report);
  if (choice.report !== "daily" && choice.period !== DEFAULT_PERIOD[choice.report]) search.set("period", choice.period);
  if (choice.repId) search.set("rep", choice.repId);
  const offered = REPORT_BREAKDOWNS[choice.report];
  if (offered.length && choice.by !== offered[0]) search.set("by", choice.by);
  const query = search.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

export function paramsFor(choice: ReportChoice, context: { organizationId: string; timeZone: string; now: Date }): ReportParams {
  return {
    organizationId: context.organizationId,
    timeZone: context.timeZone,
    now: context.now,
    range: periodRange(choice.period, context.timeZone, context.now),
    repId: choice.repId,
    by: choice.by,
  };
}

export async function loadReport(report: ReportKey, params: ReportParams): Promise<AnyReport> {
  switch (report) {
    case "daily":
      return loadDaily(params);
    case "pipeline":
      return loadPipeline(params);
    case "activity":
      return loadActivity(params);
    case "closing":
      return loadClosing(params);
    case "money":
      return loadMoney(params);
  }
}
