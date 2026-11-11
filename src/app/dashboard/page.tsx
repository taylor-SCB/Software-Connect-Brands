import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { owedTotals } from "@/lib/money";
import { todayIso } from "@/lib/payments";
import { formatCents, formatDateTime } from "@/lib/format";
import { computeQuoteTotals } from "@/lib/quote-math";
import { contractTotalCents } from "@/lib/contracts";
import { wholeDollars } from "@/lib/health";
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
import { loadMyDay } from "./my-day/load";
import { MyDayView, TeamTodayStrip } from "./my-day/my-day";
import { MemberJumpIn } from "./my-day/jump-in";
import { loadTeamToday } from "@/lib/reports/daily";
import { aiConfigured } from "@/lib/ai";
import { prefFlag, readUiPrefs } from "@/lib/user-prefs";
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
//
// The tiles and Recent activity are their own pieces (BDR redesign, Nov
// 11, 2026) so My day's collapsed "Team & money" shows the very same ones.
async function loadOverview(organizationId: string, timeZone: string, repId: string | null) {
  const mine = repId ? { ownerId: repId } : {};
  const myDeal = repId ? { deal: { ownerId: repId } } : {};

  const [
    contactCount,
    leadCount,
    openDeals,
    sentQuotes,
    awaitingContracts,
    signedCount,
    recentActivity,
    owed,
    activeProjects,
  ] = await Promise.all([
    prisma.contact.count({ where: { organizationId, ...mine } }),
    prisma.contact.count({ where: { organizationId, ...mine, status: { in: ["NOT_ACTIONED", "CONTACTED", "CONNECTED", "INTERESTED"] } } }),
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
    // Money in waiting on a signature (a purchase order the business pays
    // is not money in). A contract with its own rows is worth them; one
    // made the classic way is worth its quote.
    prisma.contract.findMany({
      where: { organizationId, ...myDeal, status: "SENT", payable: false },
      select: {
        discountCents: true,
        lineItems: { select: { quantity: true, unitPriceCents: true, discountCents: true } },
        quote: {
          select: {
            discountCents: true,
            discountPercent: true,
            lineItems: { select: { quantity: true, unitPriceCents: true, discountCents: true, tag: true } },
          },
        },
      },
    }),
    prisma.contract.count({ where: { organizationId, ...myDeal, status: "SIGNED" } }),
    // Real touches only (Nov 10, 2026): a marketing blast would fill the
    // box; it has its own column on the lists and its own chart in Activity.
    // Read wide enough to fold into 8 saves (one call logged on three
    // people is three rows with one batchId).
    prisma.activity.findMany({
      where: { organizationId, marketing: false, occurredAt: { lte: new Date() }, ...(repId ? { userId: repId } : {}) },
      orderBy: { occurredAt: "desc" },
      take: 60,
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
  const awaitingCents = awaitingContracts.reduce(
    (sum, contract) =>
      sum +
      (contract.lineItems.length
        ? contractTotalCents(contract.lineItems, contract.discountCents)
        : contract.quote
          ? computeQuoteTotals(contract.quote.lineItems, contract.quote).totalCents
          : 0),
    0,
  );
  const awaitingSignature = awaitingContracts.length;
  const saves = foldSaves(recentActivity).slice(0, 8);
  const quotedValue = sentQuotes.reduce(
    (sum, quote) => sum + computeQuoteTotals(quote.lineItems, quote).totalCents,
    0,
  );
  return { contactCount, leadCount, openDeals, sentQuotes, awaitingSignature, awaitingCents, signedCount, saves, owed, activeProjects, openDealValue, quotedValue };
}

type Overview = Awaited<ReturnType<typeof loadOverview>>;

// The money tiles (BDR redesign, Round 2): four in whole dollars — Owed to
// you, Quoted & sent, Awaiting signature, Open pipeline — 2×2 on a phone,
// with Active jobs, Contacts and Signed one tap away under "More numbers".
function OverviewTiles({ data }: { data: Overview }) {
  const { owed, activeProjects, contactCount, leadCount, openDealValue, openDeals, quotedValue, sentQuotes, awaitingSignature, awaitingCents, signedCount } = data;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="money-tiles">
        {/* The tile counts homeowners as well as companies, so it says
            where each half is rather than sending every click to the
            companies list and hiding a homeowner's share of the money. */}
        <div className="min-w-0">
          <Link href="/dashboard/companies?owed=1" className="contents">
            <StatTile
              label="Owed to you"
              value={wholeDollars(owed.owedCents)}
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
        <StatTile
          label="Quoted & sent"
          value={wholeDollars(quotedValue)}
          hint={`${sentQuotes.length} ${sentQuotes.length === 1 ? "quote" : "quotes"} out`}
          accent="#a78bfa"
        />
        <StatTile
          label="Awaiting signature"
          value={wholeDollars(awaitingCents)}
          hint={`${awaitingSignature} ${awaitingSignature === 1 ? "contract" : "contracts"} sent`}
          accent="#fbbf24"
        />
        <StatTile
          label="Open pipeline"
          value={wholeDollars(openDealValue)}
          hint={`${openDeals.length} active ${openDeals.length === 1 ? "deal" : "deals"}`}
          accent="#38bdf8"
        />
      </div>
      <details className="mt-2" data-testid="more-numbers">
        <summary className="link inline-flex min-h-11 cursor-pointer items-center text-xs sm:min-h-0">More numbers</summary>
        <div className="mt-2 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Link href="/dashboard/projects" className="contents">
            <StatTile label="Active jobs" value={activeProjects} hint="Won and still running" accent="#818cf8" />
          </Link>
          <StatTile label="Contacts" value={contactCount} hint={`${leadCount} not yet at a meeting`} />
          <StatTile label="Signed" value={signedCount} hint="Contracts closed" accent="#34d399" />
        </div>
      </details>
    </div>
  );
}

type RecentRow = Overview["saves"][number];

// One line per save (BDR redesign, Round 2): a call logged on three people
// is one line naming them — "Rebecca Sloan, Jason Tran · Magnolia · Priya".
function foldSaves<
  T extends {
    id: string;
    batchId: string | null;
    type: string;
    body: string;
    occurredAt: Date;
    contact: { id: string; name: string; company: { name: string } | null } | null;
    company: { id: string; name: string } | null;
    user: { name: string } | null;
  },
>(rows: T[]) {
  const saves: { key: string; first: T; people: { id: string; name: string }[]; company: { id: string | null; name: string } | null }[] = [];
  const byKey = new Map<string, (typeof saves)[number]>();
  for (const row of rows) {
    const key = row.batchId ?? row.id;
    let save = byKey.get(key);
    if (!save) {
      save = { key, first: row, people: [], company: null };
      byKey.set(key, save);
      saves.push(save);
    }
    if (row.contact && !save.people.some((person) => person.id === row.contact!.id)) save.people.push({ id: row.contact.id, name: row.contact.name });
    if (!save.company) save.company = row.company ? { id: row.company.id, name: row.company.name } : row.contact?.company ? { id: null, name: row.contact.company.name } : null;
  }
  return saves;
}

function RecentActivityCard({ data, repId, timeZone, className = "" }: { data: Overview; repId: string | null; timeZone: string; className?: string }) {
  const { saves } = data;
  return (
    <Card lit className={`min-w-0 ${className}`}>
      <CardHeader title="Recent activity" subtitle={repId ? "Logged by this rep" : "Across every contact"} />
      {saves.length === 0 ? (
        <EmptyState
          title="Nothing logged yet"
          body="Calls, texts, emails and meetings you log on a contact show up here."
        />
      ) : (
        <ul className="divide-y divide-[var(--hairline)]" data-testid="recent-activity">
          {saves.map((save: RecentRow) => {
            const activity = save.first;
            const Icon = ACTIVITY_ICONS[activity.type as ActivityTypeValue];
            const shown = save.people.slice(0, 3);
            return (
              <li key={save.key} className="flex min-w-0 gap-3 px-5 py-3" data-testid="recent-row">
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
                  <p className="truncate text-sm" data-testid="recent-who">
                    {shown.map((person, index) => (
                      <span key={person.id}>
                        {index > 0 && ", "}
                        <Link href={`/dashboard/contacts/${person.id}`} className="font-medium hover:underline">
                          {person.name}
                        </Link>
                      </span>
                    ))}
                    {save.people.length > shown.length && <span className="faint"> +{save.people.length - shown.length}</span>}
                    {save.company &&
                      (save.people.length === 0 && save.company.id ? (
                        <Link href={`/dashboard/companies/${save.company.id}`} className="font-medium hover:underline">
                          {save.company.name}
                        </Link>
                      ) : (
                        <span className="muted">{save.people.length ? " · " : ""}{save.company.name}</span>
                      ))}
                    {activity.user && <span className="muted"> · {activity.user.name}</span>}
                  </p>
                  <p className="faint mt-0.5 truncate text-[0.7rem]">
                    {ACTIVITY_LABELS[activity.type as ActivityTypeValue]}
                    {activity.body ? ` · ${activity.body}` : ""} · {formatDateTime(activity.occurredAt, timeZone)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

async function OverviewSummary({
  organizationId,
  name,
  timeZone,
  repId,
  member,
  today,
  intro,
  children,
}: {
  organizationId: string;
  name: string | null;
  timeZone: string;
  repId: string | null;
  // A Member gets BDR shortcuts in Jump in instead of the owner's chores
  // (BDR redesign, Nov 11, 2026).
  member: boolean;
  today: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  const data = await loadOverview(organizationId, timeZone, repId);
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

      <OverviewTiles data={data} />

      {children}
      {/* grid-cols-1 and min-w-0 (UX review, Nov 10, 2026): below lg the
          grid had one auto column, so the longest activity line set its
          width and the page panned sideways on a phone instead of the
          line ending in "…". */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <RecentActivityCard data={data} repId={repId} timeZone={timeZone} className="lg:col-span-2" />

        <Card lit className="min-w-0">
          <CardHeader title="Jump in" />
          {member ? (
            <MemberJumpIn today={today} />
          ) : (
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
          )}
        </Card>
      </div>
    </div>
  );
}

// My day's "Team & money": the whole team's tiles, Recent activity and
// the Daily Rundown's full write-up (Round 2).
async function TeamMoney({ organizationId, timeZone, businessName }: { organizationId: string; timeZone: string; businessName: string }) {
  const choice = readChoice({}, []);
  const reportParams = paramsFor(choice, { organizationId, timeZone, now: new Date() });
  const [data, report] = await Promise.all([loadOverview(organizationId, timeZone, null), loadReport("daily", reportParams)]);
  const narrative = await readNarrative({ organizationId, report, ctx: { choice, range: reportParams.range, repName: null, businessName } });
  return (
    <div className="space-y-5">
      <NarrativeCard
        key={narrative.key}
        body={narrative.body}
        source={narrative.source}
        pending={narrative.pending}
        choice={{ report: choice.report, period: choice.period, rep: "", by: choice.by }}
      />
      <OverviewTiles data={data} />
      <RecentActivityCard data={data} repId={null} timeZone={timeZone} />
    </div>
  );
}

type Search = Promise<{ report?: string; period?: string; rep?: string; by?: string; view?: string }>;

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
  const isAdmin = session.role === "OWNER" || session.role === "ADMIN";
  const member = !isAdmin;

  // My day (BDR redesign, Nov 11, 2026; decision 9): a Member's first tab
  // and where /dashboard lands them; Owners and Admins land on the Daily
  // Rundown as before and open a rep's My day from Team today, read-only.
  // ?view=myday&rep=<id> is that read-only view (anyone may look: everyone
  // sees everyone); the person's own day is the only one they can act on.
  if (params.view === "myday" || (member && !params.report && !params.view)) {
    const target = params.rep && team.some((one) => one.id === params.rep) ? params.rep : userId;
    const repRow = team.find((one) => one.id === target);
    const day = await loadMyDay(organizationId, { id: target, name: repRow?.name ?? session.name ?? "there" });
    const readOnly = target !== userId;
    const prefs = await readUiPrefs(userId);
    return (
      <div>
        <ReportBar choice={readChoice({}, [])} member={member} myDay />
        {readOnly && (
          <p className="mb-3 text-sm">
            <Link href="/dashboard" className="link" data-testid="my-day-back">
              ← Team today
            </Link>
          </p>
        )}
        <MyDayView
          day={day}
          readOnly={readOnly}
          ai={aiConfigured()}
          teamMoneyOpen={prefFlag(prefs, "myday", "teamMoney") ?? false}
          teamMoney={<TeamMoney organizationId={organizationId} timeZone={timeZone} businessName={organization.name} />}
        />
      </div>
    );
  }

  // The Daily Rundown opens on "Me" for a Member (plan R5; Round 2), with
  // Whole team one tap away as rep=all. Everyone still sees everyone.
  const wantsDaily = !params.report || params.report === "daily";
  const repParam = params.rep === "all" ? undefined : (params.rep ?? (member && wantsDaily ? userId : undefined));
  const choice = readChoice({ ...params, rep: repParam }, team.map((one) => one.id));
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
            rep={choice.repId ?? (member ? "all" : "")}
            reps={[
              { value: member ? "all" : "", label: "Whole team" },
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
        fold={choice.report === "daily"}
      />
      {choice.report !== "daily" && <HeadlineTiles headlines={report.headlines} compareLabel={range.compareLabel} />}
    </div>
  );
  const body = <ReportBody report={report} range={range} by={choice.by} />;

  const now = new Date();
  const teamToday = isAdmin && choice.report === "daily" ? await loadTeamToday(organizationId, timeZone, now) : null;

  return (
    <div>
      <ReportBar choice={choice} member={member} />
      {choice.report === "daily" ? (
        <OverviewSummary
          organizationId={organizationId}
          name={session.name}
          timeZone={timeZone}
          repId={choice.repId}
          member={member}
          today={todayIso(timeZone)}
          intro={
            <>
              {teamToday && <TeamTodayStrip team={teamToday} now={now} />}
              {head}
            </>
          }
        >
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
// breakdown go back to each report's own default. A Member's bar starts
// with My day (BDR redesign, Nov 11, 2026), so their Daily Rundown tab
// names itself in the address (a bare /dashboard is My day for them).
function ReportBar({ choice, member, myDay = false }: { choice: ReportChoice; member: boolean; myDay?: boolean }) {
  return (
    // A sideways segmented control on a phone, 44px targets (Round 2);
    // wrapping tabs from sm up.
    <nav
      className="-mx-5 mb-6 flex gap-1.5 overflow-x-auto border-b border-[var(--hairline-3)] px-5 pb-3 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      aria-label="Reports"
      data-testid="report-bar"
    >
      {member && (
        <Link
          href="/dashboard"
          className={`btn btn-sm min-h-11 shrink-0 sm:min-h-0 pointer-coarse:min-h-11 ${myDay ? "btn-primary" : "btn-ghost"}`}
          aria-current={myDay ? "page" : undefined}
          data-testid="report-tab"
          data-report="myday"
        >
          My day
        </Link>
      )}
      {REPORT_KEYS.map((key) => {
        const active = !myDay && key === choice.report;
        const target: ReportChoice = { report: key, period: "today", repId: choice.repId, by: REPORT_BREAKDOWNS[key][0] ?? "rep" };
        let href = reportHref({ ...target, period: key === "daily" ? "today" : (readChoice({ report: key }, []).period) });
        if (member && key === "daily") {
          const query = href.split("?")[1];
          href = `/dashboard?report=daily${query ? `&${query}` : ""}`;
        }
        return (
          <Link
            key={key}
            href={href}
            className={`btn btn-sm min-h-11 shrink-0 sm:min-h-0 pointer-coarse:min-h-11 ${active ? "btn-primary" : "btn-ghost"}`}
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
