import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader } from "@/components/ui";
import { loadTeam, nameOf, REPORT_LABELS, reportFromCode } from "@/lib/reports/common";
import { reportHref } from "@/lib/reports/index";
import { CADENCE_LABELS, isCadence } from "@/lib/reports/subscriptions";
import { isEmailConfigured } from "@/lib/email";
import { unsubscribeReport } from "@/app/dashboard/reports/actions";

// Settings → My Account → My report emails (Nov 10, 2026): every report
// emailed to you, with Remove. Signing up is on each report's "Email me
// this".
export async function MyReportEmails({ organizationId, userId }: { organizationId: string; userId: string }) {
  const [subscriptions, team] = await Promise.all([
    prisma.reportSubscription.findMany({
      where: { organizationId, recipientId: userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, report: true, cadence: true, repId: true, lastSentAt: true },
    }),
    loadTeam(organizationId),
  ]);
  return (
    <Card lit>
      <CardHeader title="My report emails" subtitle="Reports from Overview, emailed to you at 6am your workspace's time" />
      <div className="p-5" data-testid="my-report-emails">
        {!isEmailConfigured() && <p className="faint mb-3 text-xs">Email isn&apos;t switched on for this site yet, so these won&apos;t go out until it is.</p>}
        {subscriptions.length === 0 ? (
          <p className="faint text-sm">
            None yet. Open a report on{" "}
            <Link href="/dashboard" className="link">
              Overview
            </Link>{" "}
            and press <strong>Email me this</strong>.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {subscriptions.map((sub) => {
              const report = reportFromCode(sub.report);
              return (
                <li key={sub.id} className="flex items-center justify-between gap-3 py-2" data-testid="my-report-email">
                  <span className="min-w-0">
                    {report ? (
                      <Link href={reportHref({ report, period: "today", repId: sub.repId, by: "rep" })} className="link">
                        {REPORT_LABELS[report]}
                      </Link>
                    ) : (
                      sub.report
                    )}
                    <span className="faint text-xs">
                      {" "}
                      · {isCadence(sub.cadence) ? CADENCE_LABELS[sub.cadence] : sub.cadence} · {sub.repId ? nameOf(team, sub.repId) : "Whole team"}
                      {sub.lastSentAt ? ` · last sent ${sub.lastSentAt.toISOString().slice(0, 10)}` : ""}
                    </span>
                  </span>
                  <form action={unsubscribeReport}>
                    <input type="hidden" name="id" value={sub.id} />
                    <button type="submit" className="btn btn-ghost btn-sm" data-testid="my-report-email-remove">
                      Remove
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
