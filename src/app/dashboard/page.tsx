import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { owedTotals } from "@/lib/money";
import { todayIso } from "@/lib/payments";
import { formatCents, formatDateTime } from "@/lib/format";
import { computeQuoteTotals } from "@/lib/quote-math";
import { ACTIVITY_LABELS, OPEN_DEAL_STAGES, OPEN_PROJECT_STAGES, type ActivityTypeValue } from "@/lib/constants";
import { dealValueCents, QUOTES_FOR_VALUE } from "@/lib/deals";
import { PageHeader, Card, CardHeader, StatTile, EmptyState } from "@/components/ui";
import { getOrganization } from "@/lib/organization";
import { isEmailConfigured } from "@/lib/email";
import { loadTeam, nameOf, REPORT_BREAKDOWNS, REPORT_CODES, REPORT_KEYS, REPORT_LABELS, BREAKDOWN_LABELS } from "@/lib/reports/common";
import { loadReport, paramsFor, readChoice, reportHref, type ReportChoice } from "@/lib/reports/index";
import { readNarrative } from "@/lib/reports/narrative";
import { PERIOD_KEYS, PERIOD_LABELS } from "@/lib/reports/period";
import { CADENCE_LABELS, cadencesFor, isCadence } from "@/lib/reports/subscriptions";
import { ReportControls } from "./reports/report-controls";
import { NarrativeCard } from "./reports/narrative-card";
import { EmailMe } from "./reports/email-me";
import { HeadlineTiles, ReportBody } from "./reports/report-views";
import {
  IconPlus,
  IconFileText,
  IconSignature,
  IconMessage,
  IconMail,
  IconPhone,
  IconCalendar,
} from "@/components/icons";

const ACTIVITY_ICONS = {
  TEXT: IconMessage,
  EMAIL: IconMail,
  PHONE_CALL: IconPhone,
  MEETING: IconCalendar,
} as const;

// What Overview showed before the report bar (Nov 10, 2026) — welcome,
// the money and pipeline tiles, recent activity, the shortcuts — now the
// frame of the Daily Rundown: its write-up goes under the welcome
// (`intro`) and its lists under the tiles (`children`).
//
// With a rep picked, every tile and the activity list are that rep's too
// (audit fix, Nov 10, 2026: they stayed whole-team numbers under a scope
// line naming the rep). The same rules as the reports: money and
// paperwork by the deal's rep, contacts by their rep, activity by who
// logged it.
async function OverviewSummary({
  organizationId,
  name,
  timeZone,
  repId,
  intro,
  children,
}: {
  organizationId: string;
  name: string | null;
  timeZone: string;
  repId: string | null;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  const mine = repId ? { ownerId: repId } : {};
  const myDeal = repId ? { deal: { ownerId: repId } } : {};

  const [
    contactCount,
    leadCount,
    openDeals,
    sentQuotes,
    awaitingSignature,
    signedCount,
    recentActivity,
    owed,
    activeProjects,
  ] = await Promise.all([
    prisma.contact.count({ where: { organizationId, ...mine } }),
    prisma.contact.count({ where: { organizationId, ...mine, status: { in: ["NOT_ACTIONED", "CONTACTED", "INTERESTED"] } } }),
    prisma.deal.findMany({
      where: { organizationId, ...mine, stage: { in: [...OPEN_DEAL_STAGES] } },
      select: { valueCents: true, quotes: QUOTES_FOR_VALUE },
    }),
    prisma.quote.findMany({
      where: { organizationId, ...myDeal, status: "SENT" },
      select: {
        discountCents: true,
        discountPercent: true,
        lineItems: { select: { quantity: true, unitPriceCents: true, discountCents: true, tag: true } },
      },
    }),
    prisma.contract.count({ where: { organizationId, ...myDeal, status: "SENT" } }),
    prisma.contract.count({ where: { organizationId, ...myDeal, status: "SIGNED" } }),
    // Real touches only (Nov 10, 2026): a marketing blast would fill the
    // box; it has its own column on the lists and its own chart in Activity.
    prisma.activity.findMany({
      where: { organizationId, marketing: false, ...(repId ? { userId: repId } : {}) },
      orderBy: { occurredAt: "desc" },
      take: 8,
      include: {
        contact: { select: { id: true, name: true, company: { select: { name: true } } } },
        company: { select: { id: true, name: true } },
        user: { select: { name: true } },
      },
    }),
    // What every customer still owes on signed paperwork, in one query.
    owedTotals(organizationId, todayIso(timeZone), repId),
    prisma.project.count({ where: { organizationId, ...myDeal, stage: { in: [...OPEN_PROJECT_STAGES] } } }),
  ]);

  const openDealValue = openDeals.reduce((sum, deal) => sum + dealValueCents(deal), 0);
  const quotedValue = sentQuotes.reduce(
    (sum, quote) => sum + computeQuoteTotals(quote.lineItems, quote).totalCents,
    0,
  );

  const firstName = name?.split(" ")[0] ?? "there";

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title={`Welcome back, ${firstName}`}
        subtitle="Where every open job stands right now."
        actions={
          <>
            <Link href="/dashboard/quotes/new" className="btn btn-ghost btn-sm">
              <IconFileText size={13} />
              New quote
            </Link>
            <Link href="/dashboard/contacts/new" className="btn btn-primary btn-sm">
              <IconPlus size={14} />
              Add contact
            </Link>
          </>
        }
      />
      {intro}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* The tile counts homeowners as well as companies, so it says
            where each half is rather than sending every click to the
            companies list and hiding a homeowner's share of the money. */}
        <div>
          <Link href="/dashboard/companies?owed=1" className="contents">
            <StatTile
              label="Owed to you"
              value={formatCents(owed.owedCents)}
              hint={owed.overdueCount > 0 ? `${owed.overdueCount} past due` : `${owed.customerCount} to chase`}
              accent={owed.overdueCount > 0 ? "#f87171" : "#34d399"}
            />
          </Link>
          <p className="faint mt-1.5 text-xs" data-testid="owed-where">
            <Link href="/dashboard/companies?owed=1" className="link">
              Companies
            </Link>
            {" · "}
            <Link href="/dashboard/contacts?owed=1" className="link">
              People with no company
            </Link>
          </p>
        </div>
        <Link href="/dashboard/projects" className="contents">
          <StatTile
            label="Active jobs"
            value={activeProjects}
            hint="Won and still running"
            accent="#818cf8"
          />
        </Link>
        <StatTile label="Contacts" value={contactCount} hint={`${leadCount} not yet at a meeting`} />
        <StatTile
          label="Open pipeline"
          value={formatCents(openDealValue)}
          hint={`${openDeals.length} active deals`}
          accent="#38bdf8"
        />
        <StatTile
          label="Quoted & sent"
          value={formatCents(quotedValue)}
          hint={`${sentQuotes.length} quotes out`}
          accent="#a78bfa"
        />
        <StatTile
          label="Awaiting signature"
          value={awaitingSignature}
          hint="Contracts sent"
          accent="#fbbf24"
        />
        <StatTile
          label="Signed"
          value={signedCount}
          hint="Contracts closed"
          accent="#34d399"
        />
      </div>

      {children}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card lit className="lg:col-span-2">
          <CardHeader title="Recent activity" subtitle={repId ? "Logged by this rep" : "Across every contact"} />
          {recentActivity.length === 0 ? (
            <EmptyState
              title="Nothing logged yet"
              body="Calls, texts, emails and meetings you log on a contact show up here."
            />
          ) : (
            <ul className="divide-y divide-[var(--hairline)]">
              {recentActivity.map((activity) => {
                const Icon = ACTIVITY_ICONS[activity.type as ActivityTypeValue];
                return (
                  <li key={activity.id} className="flex gap-3 px-5 py-3">
                    <div
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        background: "color-mix(in srgb, var(--brand) 14%, transparent)",
                        color: "var(--brand)",
                      }}
                    >
                      <Icon size={14} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm">{activity.body}</p>
                      <p className="faint mt-0.5 text-[0.7rem]">
                        {activity.contact ? (
                          <Link href={`/dashboard/contacts/${activity.contact.id}`} className="link">
                            {activity.contact.company?.name || activity.contact.name}
                          </Link>
                        ) : activity.company ? (
                          <Link href={`/dashboard/companies/${activity.company.id}`} className="link">
                            {activity.company.name}
                          </Link>
                        ) : null}{" "}
                        · {ACTIVITY_LABELS[activity.type as ActivityTypeValue]} ·{" "}
                        {formatDateTime(activity.occurredAt, timeZone)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card lit>
          <CardHeader title="Jump in" />
          <div className="space-y-2 p-5">
            <Link href="/dashboard/products" className="nav-item">
              Manage product catalog
            </Link>
            <Link href="/dashboard/quotes/new" className="nav-item">
              Build a quote
            </Link>
            <Link href="/dashboard/contracts/templates" className="nav-item">
              Edit contract templates
            </Link>
            <Link href="/dashboard/contracts/new" className="nav-item">
              <IconSignature size={15} className="opacity-70" />
              Send a contract
            </Link>
            <Link href="/dashboard/settings" className="nav-item">
              Change branding
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

type Search = Promise<{ report?: string; period?: string; rep?: string; by?: string }>;

// Overview (/dashboard) with the report bar across the top (Nov 10, 2026):
// Daily Rundown (the default, wrapped in what Overview always showed),
// Pipeline, Activity, Closing and Money Owed. What is picked lives in the
// address bar; the numbers come from src/lib/reports/, the same functions
// the 6am email and the write-up read.
export default async function DashboardPage({ searchParams }: { searchParams: Search }) {
  const session = await requireSession();
  const { organizationId, userId } = session;
  const params = await searchParams;
  const [team, timeZone, organization] = await Promise.all([loadTeam(organizationId), getTimeZone(), getOrganization()]);
  const choice = readChoice(params, team.map((member) => member.id));
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  const reportParams = paramsFor(choice, { organizationId, timeZone, now: new Date() });
  const repName = choice.repId ? nameOf(team, choice.repId) : null;

  const [report, subscriptions] = await Promise.all([
    loadReport(choice.report, reportParams),
    prisma.reportSubscription.findMany({
      where: { organizationId, report: REPORT_CODES[choice.report], ...(isAdmin ? {} : { recipientId: userId }) },
      orderBy: { createdAt: "asc" },
      select: { id: true, report: true, cadence: true, repId: true, recipient: { select: { name: true } } },
    }),
  ]);
  const narrative = await readNarrative({
    organizationId,
    report,
    ctx: { choice, range: reportParams.range, repName, businessName: organization.name },
  });
  const range = reportParams.range;
  const label = REPORT_LABELS[choice.report];

  const head = (
    <div className="mb-5 space-y-4" data-testid="report" data-report={choice.report}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="faint text-xs" data-testid="report-scope">
            {choice.report === "daily" ? `Daily Rundown · ${range.span}` : `${label} · ${range.label} · ${range.span}`} · {repName ?? "Whole team"}
            {choice.report !== "daily" && ` · compared with ${range.compareLabel}`}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <ReportControls
            base={{ report: choice.report }}
            period={choice.report === "daily" ? null : choice.period}
            periods={PERIOD_KEYS.map((key) => ({ value: key, label: PERIOD_LABELS[key] }))}
            rep={choice.repId ?? ""}
            reps={[
              { value: "", label: "Whole team" },
              ...team.filter((member) => !member.removed || member.id === choice.repId).map((member) => ({ value: member.id, label: nameOf(team, member.id) })),
            ]}
            by={REPORT_BREAKDOWNS[choice.report].length ? choice.by : null}
            breakdowns={REPORT_BREAKDOWNS[choice.report].map((key) => ({ value: key, label: BREAKDOWN_LABELS[key] }))}
          />
          <EmailMe
            report={choice.report}
            reportLabel={label}
            cadences={cadencesFor(choice.report).map((cadence) => ({ value: cadence, label: CADENCE_LABELS[cadence] }))}
            meId={userId}
            isAdmin={isAdmin}
            teammates={team.filter((member) => !member.removed).map((member) => ({ id: member.id, name: member.name }))}
            repId={choice.repId ?? ""}
            repName={repName ?? "Whole team"}
            subscriptions={subscriptions.map((sub) => ({
              id: sub.id,
              recipient: sub.recipient.name,
              cadence: isCadence(sub.cadence) ? CADENCE_LABELS[sub.cadence] : sub.cadence,
              about: sub.repId ? nameOf(team, sub.repId) : "Whole team",
            }))}
            emailOn={isEmailConfigured()}
          />
        </div>
      </div>
      <NarrativeCard
        key={narrative.key}
        body={narrative.body}
        source={narrative.source}
        pending={narrative.pending}
        choice={{ report: choice.report, period: choice.period, rep: choice.repId ?? "", by: choice.by }}
      />
      {choice.report !== "daily" && <HeadlineTiles headlines={report.headlines} compareLabel={range.compareLabel} />}
    </div>
  );
  const body = <ReportBody report={report} range={range} by={choice.by} />;

  return (
    <div>
      <ReportBar choice={choice} />
      {choice.report === "daily" ? (
        <OverviewSummary organizationId={organizationId} name={session.name} timeZone={timeZone} repId={choice.repId} intro={head}>
          <div className="mt-5">{body}</div>
        </OverviewSummary>
      ) : (
        <>
          <PageHeader eyebrow="Overview" title={label} />
          {head}
          {body}
        </>
      )}
    </div>
  );
}

// The five reports as tabs. Switching keeps the rep; the period and the
// breakdown go back to each report's own default.
function ReportBar({ choice }: { choice: ReportChoice }) {
  return (
    <nav className="mb-6 flex flex-wrap gap-1.5 border-b border-[var(--border)] pb-3" aria-label="Reports" data-testid="report-bar">
      {REPORT_KEYS.map((key) => {
        const active = key === choice.report;
        const target: ReportChoice = { report: key, period: "today", repId: choice.repId, by: REPORT_BREAKDOWNS[key][0] ?? "rep" };
        return (
          <Link
            key={key}
            href={reportHref({ ...target, period: key === "daily" ? "today" : (readChoice({ report: key }, []).period) })}
            className={`btn btn-sm ${active ? "btn-primary" : "btn-ghost"}`}
            aria-current={active ? "page" : undefined}
            data-testid="report-tab"
            data-report={key}
          >
            {REPORT_LABELS[key]}
          </Link>
        );
      })}
    </nav>
  );
}
