import { prisma } from "@/lib/prisma";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { isReportKey, loadTeam, nameOf, REPORT_LABELS, reportFromCode, type ReportKey } from "@/lib/reports/common";
import { loadReport, paramsFor, reportHref, type ReportChoice } from "@/lib/reports/index";
import { REPORT_BREAKDOWNS } from "@/lib/reports/common";
import { writeNarrative } from "@/lib/reports/narrative";
import { reportEmail } from "@/lib/reports/email";
import { CADENCE_LABELS, isCadence, periodForCadence, SEND_HOUR, sendsOn, type Cadence } from "@/lib/reports/subscriptions";
import { formatIsoDay, localIso, periodRange, zonedHour, zonedParts } from "@/lib/reports/period";

// The hourly clock behind "Email me this" (Nov 10, 2026). Vercel calls
// /api/cron/reports at the top of every hour; this sends, for every active
// workspace whose clock has reached 6am today, each subscription due today
// that has not gone out since 6am. lastSentAt is the receipt: a
// subscription is claimed by moving it (a conditional update only one run
// can win) before its email is sent, and put back if the send fails, so a
// second run in the same hour — or the clock firing twice — sends nothing
// twice, and a run that ran out of time is picked up by the next hour's.
// A subscription made after 6am waits for its next morning.

// Resend allows about two requests a second.
const SEND_SPACING_MS = 550;

export type CronResult = {
  emailOn: boolean;
  workspaces: number;
  due: number;
  sent: number;
  failed: number;
  // Left for the next run because this one ran out of time.
  deferred: number;
  sentTo: { email: string; report: string; cadence: string }[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runReportEmails(input: { now: Date; baseUrl: string; budgetMs: number }): Promise<CronResult> {
  const started = Date.now();
  const result: CronResult = { emailOn: isEmailConfigured(), workspaces: 0, due: 0, sent: 0, failed: 0, deferred: 0, sentTo: [] };
  // With email off nothing is claimed, so the day's emails go the first
  // hour it is switched on.
  if (!result.emailOn) return result;

  const workspaces = await prisma.organization.findMany({
    where: { status: "ACTIVE", reportSubscriptions: { some: {} } },
    select: { id: true, name: true, timeZone: true },
    orderBy: { createdAt: "asc" },
  });

  let spaced = false;
  for (const workspace of workspaces) {
    const timeZone = safeZone(workspace.timeZone);
    const clock = zonedParts(input.now, timeZone);
    if (clock.hour < SEND_HOUR) continue;
    const today = localIso(input.now, timeZone);
    // 6am today on the workspace's clock.
    const morning = zonedHour(today, SEND_HOUR, timeZone);

    const subscriptions = await prisma.reportSubscription.findMany({
      where: {
        organizationId: workspace.id,
        createdAt: { lt: morning },
        OR: [{ lastSentAt: null }, { lastSentAt: { lt: morning } }],
        recipient: { removedAt: null },
      },
      select: {
        id: true,
        report: true,
        cadence: true,
        repId: true,
        lastSentAt: true,
        recipient: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const due = subscriptions.filter((sub) => {
      const report = reportFromCode(sub.report);
      return report && isCadence(sub.cadence) && sendsOn(sub.cadence, input.now, timeZone);
    });
    if (!due.length) continue;
    result.workspaces += 1;
    result.due += due.length;

    const team = await loadTeam(workspace.id);
    const teamIds = new Set(team.map((member) => member.id));
    // One report and one write-up per (report, cadence, rep), however many
    // people get it.
    const groups = new Map<string, typeof due>();
    for (const sub of due) {
      const key = `${sub.report}|${sub.cadence}|${sub.repId ?? ""}`;
      groups.set(key, [...(groups.get(key) ?? []), sub]);
    }

    for (const subs of groups.values()) {
      if (Date.now() - started > input.budgetMs) {
        result.deferred += subs.length;
        continue;
      }
      const first = subs[0];
      const report = reportFromCode(first.report) as ReportKey;
      const cadence = first.cadence as Cadence;
      if (!isReportKey(report)) continue;
      const repId = first.repId && teamIds.has(first.repId) ? first.repId : null;
      const choice: ReportChoice = { report, period: periodForCadence(report, cadence), repId, by: REPORT_BREAKDOWNS[report][0] ?? "rep" };
      const params = paramsFor(choice, { organizationId: workspace.id, timeZone, now: input.now });
      const data = await loadReport(report, params);
      const repName = repId ? nameOf(team, repId) : null;
      const narrative = await writeNarrative({
        organizationId: workspace.id,
        userId: null,
        report: data,
        ctx: { choice, range: params.range, repName, businessName: workspace.name },
      });
      const range = periodRange(choice.period, timeZone, input.now);
      const periodText = report === "daily" ? formatIsoDay(today, true) : `${range.label} · ${range.span}`;
      const message = reportEmail({
        businessName: workspace.name,
        reportLabel: REPORT_LABELS[report],
        periodText,
        whoFor: repName ?? "The whole team",
        narrative: narrative.body,
        headlines: data.headlines,
        table: data.table,
        url: `${input.baseUrl}${reportHref(choice, "/dashboard", { explicit: true })}`,
        settingsUrl: `${input.baseUrl}/dashboard/settings/account`,
        cadenceLabel: CADENCE_LABELS[cadence],
      });

      for (const sub of subs) {
        if (Date.now() - started > input.budgetMs) {
          result.deferred += 1;
          continue;
        }
        const claimed = await prisma.reportSubscription.updateMany({
          where: { id: sub.id, OR: [{ lastSentAt: null }, { lastSentAt: { lt: morning } }] },
          data: { lastSentAt: input.now },
        });
        if (claimed.count === 0) continue;
        if (spaced) await sleep(SEND_SPACING_MS);
        spaced = true;
        let sent = await sendEmail({ to: sub.recipient.email, fromName: workspace.name, ...message });
        if (!sent.ok && /\b429\b/.test(sent.error)) {
          await sleep(1500);
          sent = await sendEmail({ to: sub.recipient.email, fromName: workspace.name, ...message });
        }
        if (sent.ok) {
          result.sent += 1;
          result.sentTo.push({ email: sub.recipient.email, report: sub.report, cadence: sub.cadence });
        } else {
          result.failed += 1;
          console.error(`[report-email] ${sub.id} to ${sub.recipient.email}: ${sent.error}`);
          // Put the receipt back so the next hour tries again.
          await prisma.reportSubscription.updateMany({
            where: { id: sub.id, lastSentAt: input.now },
            data: { lastSentAt: sub.lastSentAt },
          });
        }
      }
    }
  }
  return result;
}

function safeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "America/Chicago";
  }
}
