import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents, formatDateTime } from "@/lib/format";
import { ACTIVITY_TYPES, NOTE_LABEL_NAMES, OPEN_DEAL_STAGES, PERSONAL_NOTE_LABELS, isPersonalLabel, type ActivityTypeValue, type NoteLabelValue } from "@/lib/constants";
import { dealValueCents, isOpenStage, QUOTES_FOR_VALUE } from "@/lib/deals";
import { batchOthers } from "@/lib/logging";
import { Card, CardHeader, BackLink, StatusBadge, DealStageBadge } from "@/components/ui";
import { IconGlobe, IconEdit } from "@/components/icons";
import { StarButton } from "@/components/star-button";
import { AutoPill } from "@/components/auto-pill";
import { TagCell } from "../../contacts/contacts-list";
import { deleteCompany, setCompanyFavorite } from "../actions";
import { HeaderDeleteButton } from "@/components/header-delete-button";
import { StatusPicker } from "@/components/status-picker";
import { meetingSetDay } from "@/lib/status";
import { dayInZone } from "@/lib/calendar-auto";
import { AddPersonSearch } from "@/components/add-person-search";
import { MergeButton } from "@/components/merge-button";
import { LooksRightButton } from "./looks-right-button";
import { ActivityOverview } from "@/components/activity-overview";
import { BalanceCard } from "@/components/balance-card";
import { ProjectsCard } from "@/components/projects-card";
import { UpcomingCard } from "@/components/upcoming-card";
import { loadEventChoices, upcomingFor } from "@/lib/calendar-data";
import { loadBalance } from "@/lib/money";
import { todayIso } from "@/lib/payments";
import { Avatar } from "@/components/avatar";
import { ActivityFeed, type ActivityItem } from "@/components/activity-feed";
import { NotesList } from "@/components/notes-list";
import { AddNoteForm } from "../../contacts/[id]/forms";
import { OtherContacts, type BypassGroup } from "@/components/other-contacts";
import { AddedBy } from "@/components/crm-cells";
import { RepPicker } from "@/components/rep-select";
import { loadRepChoices } from "@/lib/reps";
import { LeadLabelChip } from "@/components/lead-label-chip";
import { HealthRing } from "@/components/health-marks";
import { HealthWord } from "@/components/health-word";
import { companyHealth, healthSettings, loadContactHealth } from "@/lib/health-load";
import { aheadDay, isoDiff, pastDay, shortDay, time12, warmth, wholeDollars, zoneDay, zoneTime, type LeadHealth } from "@/lib/health";
import { CompanyShell } from "./company-shell";
import { HeaderActions, type MainAction } from "./header-actions";
import { WhoToCall, type CallRow } from "./who-to-call";
import { FoldCard, HistoryChunk, HistoryShell, LogTouch, NextStepStrip, PhoneBar, ShowCounts } from "./sections";
import { lastTouchLines, mainContactIds, meetingFor, openOpportunities, stageOrder, whoToCallPage } from "./load";

// A company can have thousands of people and years of activity, so the
// page shows the people fifty at a time and the latest slice of every
// feed, with counts for the rest.
const PEOPLE_PER_PAGE = 50;
const FEED_LIMIT = 200;

// The company page (BDR redesign, Nov 11, 2026; Taylor approved the plan).
// It answers, in order: who to call here, what happened last, and the one
// next step. The header reads like a contact's — the logo in the warmest
// person's health ring, "City · Industry", the Rep, the star, a red "Owes"
// when money is late — with one main button that follows the stage, Call
// main line, Email and ⋯ More (Add person, Edit, Merge, Set status by
// hand, Delete at the foot), and the meter of the person furthest along
// with "2 of 7 people reached". Then Who to call, the next thing booked,
// Log a touch (folded), the history by day and the notes; on the right the
// open Pipeline tile, Balance when money is owed, Good to know, Coming up,
// paperwork once there is some, and Details (folded).
export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ people?: string }>;
}) {
  const { id } = await params;
  const { people: peopleParam } = await searchParams;
  const { organizationId, userId, name: userName } = await requireSession();

  const settings = await healthSettings(organizationId);
  const timeZone = settings.timeZone;
  const now = new Date();

  const company = await prisma.company.findFirst({
    where: { id, organizationId },
    include: { _count: { select: { contacts: true, linkedContacts: true } }, createdBy: { select: { name: true } } },
  });
  if (!company) notFound();

  // People: everyone whose main company this is, plus anyone linked here
  // as an additional account (Sept 30, 2026), who wear a small tag.
  const peopleTotal = company._count.contacts + company._count.linkedContacts;
  const peoplePages = Math.max(1, Math.ceil(peopleTotal / PEOPLE_PER_PAGE));
  const peoplePage = Math.min(peoplePages, Math.max(1, Number(peopleParam) || 1));
  // The linked ids first, then one indexed OR: a relation filter inside
  // the OR made Postgres walk every contact in the workspace (2.9s at
  // 200,000 contacts, against a 2s budget).
  const linkedIds = company._count.linkedContacts
    ? (await prisma.contactAccount.findMany({ where: { companyId: company.id }, select: { contactId: true }, take: 5000 })).map((row) => row.contactId)
    : [];
  const people = await whoToCallPage(organizationId, company.id, linkedIds, peoplePage, PEOPLE_PER_PAGE);
  const peopleIds = people.map((person) => person.id);

  // Everything logged on the company itself, plus everything logged on
  // its people, in one feed. `via` says which person an entry came from.
  const viaPeople = { contact: { companyId: company.id } };
  const [notes, activities, deals, quotes, contracts, health, peopleHealth, mains, opportunities] = await Promise.all([
    prisma.note.findMany({
      where: { organizationId, OR: [{ companyId: company.id }, viaPeople] },
      orderBy: { createdAt: "desc" },
      take: FEED_LIMIT,
      include: {
        author: { select: { name: true } },
        contact: { select: { id: true, name: true } },
      },
    }),
    prisma.activity.findMany({
      where: { organizationId, OR: [{ companyId: company.id }, viaPeople] },
      orderBy: { occurredAt: "desc" },
      take: FEED_LIMIT,
      include: {
        user: { select: { name: true } },
        contact: { select: { id: true, name: true } },
      },
    }),
    prisma.deal.findMany({
      where: { organizationId, ...viaPeople },
      orderBy: { createdAt: "desc" },
      take: FEED_LIMIT,
      include: {
        contact: { select: { id: true, name: true } },
        quotes: QUOTES_FOR_VALUE,
        _count: { select: { quotes: true } },
      },
    }),
    prisma.quote.findMany({
      where: { organizationId, ...viaPeople },
      orderBy: { createdAt: "desc" },
      take: FEED_LIMIT,
      include: { contact: { select: { name: true } }, deal: { select: { title: true } } },
    }),
    prisma.contract.findMany({
      where: { organizationId, ...viaPeople },
      orderBy: { createdAt: "desc" },
      take: FEED_LIMIT,
      include: { contact: { select: { name: true } } },
    }),
    companyHealth(organizationId, company.id, { settings, now }),
    loadContactHealth(organizationId, peopleIds, { settings, now }),
    mainContactIds(organizationId, peopleIds),
    openOpportunities(organizationId, company.id),
  ]);
  if (!health) notFound();

  // Totals come from their own count queries, so a company with more
  // history than the feeds show still reads the right numbers.
  const [noteOthers, activityOthers, noteTotal, personalNoteTotal, activityByType, dealTotal, quotesOutTotal, openDealRows, lastLines] =
    await Promise.all([
      batchOthers("note", notes.map((note) => note.batchId)),
      batchOthers("activity", activities.map((activity) => activity.batchId)),
      prisma.note.count({ where: { organizationId, OR: [{ companyId: company.id }, viaPeople] } }),
      prisma.note.count({ where: { organizationId, label: { in: [...PERSONAL_NOTE_LABELS] }, OR: [{ companyId: company.id }, viaPeople] } }),
      // Touches only: marketing sends are on the feed, never counted. One
      // touch logged on several people at once is one row each sharing a
      // batchId, and counts once (Nov 10, 2026): grouped by batch too, a
      // batch is one group and the rows with none are counted as they are.
      prisma.activity.groupBy({
        by: ["type", "batchId"],
        where: { organizationId, marketing: false, OR: [{ companyId: company.id }, viaPeople] },
        _count: { _all: true },
      }),
      prisma.deal.count({ where: { organizationId, ...viaPeople } }),
      prisma.quote.count({ where: { organizationId, ...viaPeople, status: "SENT" } }),
      prisma.deal.findMany({
        where: { organizationId, ...viaPeople, stage: { in: [...OPEN_DEAL_STAGES] } },
        select: { valueCents: true, stage: true, quotes: QUOTES_FOR_VALUE },
      }),
      lastTouchLines(organizationId, peopleIds, peopleHealth, timeZone, now),
    ]);

  const today = todayIso(timeZone);
  const meetingSet = await meetingSetDay(organizationId, { companyId: company.id });

  // Not linked to a person yet: what was logged here with nobody linked,
  // newest first, grouped under whoever logged it, for claiming.
  const unclaimed = await prisma.activity.findMany({
    where: { organizationId, companyId: company.id, contactId: null },
    orderBy: { occurredAt: "desc" },
    take: 100,
    select: { id: true, type: true, body: true, occurredAt: true, user: { select: { id: true, name: true } } },
  });
  const bypassGroups = Array.from(
    unclaimed.reduce((groups, row) => {
      const group = groups.get(row.user.id) ?? { userId: row.user.id, userName: row.user.name, activities: [] };
      group.activities.push({ id: row.id, type: row.type, body: row.body, when: formatDateTime(row.occurredAt, timeZone) });
      return groups.set(row.user.id, group);
    }, new Map<string, BypassGroup>()),
  ).map(([, group]) => group);
  // What this company owes and what we owe them, for the Balance card.
  const balance = await loadBalance(organizationId, { companyId: company.id }, today);

  const [upcoming, eventChoices, reps, lastTouch] = await Promise.all([
    upcomingFor(organizationId, { companyId: company.id }, today),
    loadEventChoices(organizationId, userId),
    loadRepChoices(organizationId),
    prisma.activity.findFirst({
      where: { organizationId, marketing: false, OR: [{ companyId: company.id }, viaPeople] },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true },
    }),
  ]);

  // The jobs won here, newest first.
  const projects = await prisma.project.findMany({
    where: { organizationId, OR: [{ companyId: company.id }, { contact: { companyId: company.id } }] },
    orderBy: { updatedAt: "desc" },
    take: FEED_LIMIT,
    select: {
      id: true,
      number: true,
      name: true,
      stage: true,
      awardedCents: true,
      spentCents: true,
      committedCents: true,
    },
  });

  /* ------------------------------ Who to call ------------------------------ */

  const rows: (CallRow & { status: string })[] = people
    .flatMap((person) => {
      const personHealth = peopleHealth.get(person.id);
      if (!personHealth) return [];
      return [
        {
          id: person.id,
          name: person.name,
          title: person.title,
          phone: person.phone,
          phone2: person.phone2,
          mobile: person.mobile,
          favorite: person.favorite,
          linked: person.companyId !== company.id,
          main: mains.has(person.id),
          last: lastLines.get(person.id) ?? null,
          health: personHealth,
          status: person.status,
        },
      ];
    })
    // Stage first (the SQL's order), the warmest first within a stage.
    .sort((a, b) => stageOrder(a.status) - stageOrder(b.status) || warmth(b.health) - warmth(a.health));

  // The pickers' hover line shows a number; someone with only a mobile
  // on file has that one.
  const companyPeople = people.map((person) => ({ id: person.id, name: person.name, email: person.email, phone: person.phone ?? person.mobile }));

  /* ------------------------------ Main action ------------------------------ */

  // The company wears the meter of its person furthest along; the main
  // button is that meter's next step, about that person.
  const reach = (h: LeadHealth) => (h.meter.won ? 7 : h.meter.closed ? -1 : h.meter.step);
  const furthest = rows.reduce<CallRow | null>((best, row) => (!best || reach(row.health) > reach(best.health) ? row : best), null);
  const warmest = rows.find((row) => row.id === health.warmestId) ?? rows[0] ?? null;
  const about = furthest ?? warmest;
  const latest = <T extends { status: string; updatedAt: Date }>(list: T[], status: string) =>
    list.filter((row) => row.status === status).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
  const mainAction = await (async (): Promise<MainAction> => {
    const step = health.meter.action;
    switch (step?.key) {
      case "call": {
        const reachable = rows.find((row) => row.mobile || row.phone || row.phone2);
        if (reachable) {
          return {
            kind: "call",
            label: `Call ${reachable.name.trim().split(/\s+/)[0]}`,
            tel: `tel:${reachable.mobile ?? reachable.phone ?? reachable.phone2}`,
            contactId: reachable.id,
          };
        }
        if (company.phone) return { kind: "call", label: "Call main line", tel: `tel:${company.phone}`, contactId: null };
        return { kind: "log", label: "Log a touch" };
      }
      case "book":
        return { kind: "book", label: step.label, contactId: (warmest ?? about)?.id ?? null };
      case "meeting":
      case "mark-held": {
        const meeting = about ? await meetingFor(organizationId, about.id, now, today) : null;
        if (step.key === "meeting") {
          const ahead = meeting?.aheadMeetingId
            ? await prisma.opportunityMeeting.findFirst({ where: { id: meeting.aheadMeetingId }, select: { on: true } })
            : null;
          const day = ahead ? zoneDay(ahead.on, timeZone) : today;
          return { kind: "meeting", label: step.label, href: `/dashboard/calendar?on=${day}`, meetingId: meeting?.aheadMeetingId ?? null, on: day };
        }
        return { kind: "mark-held", label: step.label, meetingId: meeting?.pastMeetingId ?? null, entryId: meeting?.entryId ?? null, contactId: about?.id ?? null };
      }
      case "start-quote":
        return { kind: "link", label: step.label, href: about ? `/dashboard/quotes/new?contactId=${about.id}` : "/dashboard/quotes/new" };
      case "quote-yes": {
        const quote = latest(quotes, "SENT");
        return quote ? { kind: "link", label: step.label, href: `/dashboard/quotes/${quote.id}` } : { kind: "link", label: "Start a quote", href: `/dashboard/quotes/new${about ? `?contactId=${about.id}` : ""}` };
      }
      case "signing-link": {
        const contract = latest(contracts, "SENT");
        return contract ? { kind: "copy", label: step.label, text: `/c/${contract.publicToken}`, href: `/dashboard/contracts/${contract.id}` } : { kind: "log", label: "Log a touch" };
      }
      case "deposit": {
        const contract = latest(contracts, "SIGNED");
        return contract ? { kind: "link", label: step.label, href: `/dashboard/contracts/${contract.id}` } : { kind: "log", label: "Log a touch" };
      }
      default:
        return { kind: "log", label: "Log a touch" };
    }
  })();

  /* -------------------------------- History -------------------------------- */

  // The feed shows a touch logged on several people here once, naming
  // each of them (Nov 10, 2026); it had listed one copy per person. The
  // newest row of a batch stands for the rest.
  const feed: (typeof activities[number] & { people: { id: string; name: string }[] })[] = [];
  const byBatch = new Map<string, (typeof feed)[number]>();
  for (const activity of activities) {
    const shown = activity.batchId ? byBatch.get(activity.batchId) : undefined;
    if (shown) {
      if (activity.contact) shown.people.push(activity.contact);
      continue;
    }
    const entry = { ...activity, people: activity.contact ? [activity.contact] : [] };
    feed.push(entry);
    if (activity.batchId) byBatch.set(activity.batchId, entry);
  }
  // Grouped by day on the workspace's calendar, in chunks: the first five
  // lines, then up to thirty (folded on a phone), then the rest (folded
  // everywhere until Show all).
  type Block = { tier: "first" | "phone" | "more"; day: string; heading: boolean; items: ActivityItem[] };
  const blocks: Block[] = [];
  const seenDays = new Set<string>();
  feed.forEach((activity, index) => {
    const tier = index < 5 ? "first" : index < 30 ? "phone" : "more";
    const day = zoneDay(activity.occurredAt, timeZone);
    const item: ActivityItem = {
      id: activity.id,
      type: activity.type,
      body: activity.body,
      userName: activity.user.name,
      when: time12(zoneTime(activity.occurredAt, timeZone)) ?? "",
      // Copies on people not on this page (another company's, or past
      // the feed's last row) are still "also on N".
      others: activity.batchId ? Math.max(0, (activityOthers.get(activity.batchId) ?? 0) + 1 - activity.people.length) : 0,
      via: activity.people.length ? activity.people : null,
      bypassedBy: activity.contact ? null : activity.user.name,
      marketing: activity.marketing,
    };
    const last = blocks[blocks.length - 1];
    if (last && last.tier === tier && last.day === day) last.items.push(item);
    else blocks.push({ tier, day, heading: !seenDays.has(day), items: [item] });
    seenDays.add(day);
  });
  const dayWords = (day: string) => {
    const back = isoDiff(today, day);
    if (back <= 0) return "Today";
    if (back === 1) return "Yesterday";
    if (back < 7) return `${pastDay(day, today)} ${shortDay(day)}`;
    return day.slice(0, 4) === today.slice(0, 4) ? shortDay(day) : `${shortDay(day)}, ${day.slice(0, 4)}`;
  };

  /* -------------------------------- Counts -------------------------------- */

  const activityCounts = ACTIVITY_TYPES.reduce(
    (acc, type) => {
      acc[type] = activityByType
        .filter((row) => row.type === type)
        .reduce((sum, row) => sum + (row.batchId ? 1 : row._count._all), 0);
      return acc;
    },
    {} as Record<ActivityTypeValue, number>,
  );
  const openDeals = openDealRows.filter((deal) => isOpenStage(deal.stage));
  const openDealValue = openDeals.reduce((sum, deal) => sum + dealValueCents(deal), 0);

  const where = [company.city, company.industries[0]].filter(Boolean).join(" · ");
  const owes = balance.owed.owedCents;
  const late = balance.owed.overdueCount > 0;
  const showBalance = owes > 0 || balance.payable.owedCents > 0;
  // Good to know: the latest two personal notes (Personal, Birthday,
  // Hobbies, Family) on the company or its people, as on a contact's page.
  const goodToKnow = notes.filter((note) => isPersonalLabel(note.label)).slice(0, 2);
  const hasPaperwork = deals.length > 0 || quotes.length > 0 || contracts.length > 0;
  // "2 deals · 1 quote · 1 contract across everyone here".
  const paperworkWords = `${[
    [dealTotal, "deal", "deals"],
    [quotes.length, "quote", "quotes"],
    [contracts.length, "contract", "contracts"],
  ]
    .filter(([n]) => Number(n) > 0)
    .map(([n, one, many]) => `${Number(n) === FEED_LIMIT ? `${FEED_LIMIT}+` : Number(n).toLocaleString()} ${Number(n) === 1 ? one : many}`)
    .join(" · ")} across everyone here`;
  const next = upcoming[0] ?? null;
  const reachedWords = health.people === 0 ? null : `${health.reached} of ${health.people} ${health.people === 1 ? "person" : "people"} reached`;

  return (
    // On a touch screen every button on the page is at least 44px tall,
    // the shared cards' small ones included.
    <div className="max-lg:pb-24 pointer-coarse:[&_.btn]:min-h-11">
      <BackLink href="/dashboard/companies" label="Companies" current={company.name} />

      <CompanyShell
        companyId={company.id}
        companyName={company.name}
        people={rows.map((row) => ({ id: row.id, name: row.name, title: row.title }))}
        companyPeople={companyPeople}
        userName={userName}
        today={today}
      >
        <header id="company-header" className="card card-lit mb-5 scroll-mt-4 p-4 sm:p-5" data-testid="company-header">
          <div className="flex items-start gap-3 sm:gap-4">
            <HealthRing health={health}>
              <Avatar url={company.logoUrl} name={company.name} size={56} round />
            </HealthRing>
            <div className="min-w-0 flex-1">
              <p className="eyebrow mb-1">Company</p>
              <div className="flex items-start gap-2">
                <h1 className="page-title min-w-0 break-words text-[1.75rem] leading-tight">{company.name}</h1>
                <span className="mt-1 shrink-0">
                  <StarButton id={company.id} favorite={company.favorite} action={setCompanyFavorite} label={company.name} size={18} />
                </span>
              </div>
              {where && (
                <p className="muted mt-0.5 text-sm" data-testid="company-where">
                  {where}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <HealthWord health={health} />
                {owes > 0 && (
                  <a
                    href="#balance"
                    className={`badge font-semibold ${late ? "border-[var(--danger)] text-[var(--danger)]" : "border-[var(--border-strong)] text-[var(--text)]"}`}
                    data-testid="company-owes"
                    data-late={late ? "1" : undefined}
                  >
                    Owes {wholeDollars(owes)}
                    {late ? " · late" : ""}
                  </a>
                )}
                <span className="inline-flex items-center gap-1.5 text-xs [&_select]:w-auto [&_select]:max-w-[11rem]" data-testid="company-rep">
                  <span className="faint">Rep</span>
                  <RepPicker key={company.ownerId ?? "none"} kind="company" id={company.id} ownerId={company.ownerId} reps={reps} />
                </span>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <HeaderActions
              action={mainAction}
              health={health}
              mainLine={company.phone}
              email={company.email}
              more={
                <>
                  <AddPersonSearch companyId={company.id} companyName={company.name} />
                  <Link href={`/dashboard/companies/${company.id}/edit`} className="btn btn-ghost btn-sm pointer-coarse:min-h-11" data-testid="company-edit">
                    <IconEdit size={13} />
                    Edit
                  </Link>
                  <MergeButton kind="companies" initial={[{ id: company.id, name: company.name, city: company.city, state: company.state }]} label="Merge" />
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span className="faint">Set status by hand</span>
                    <StatusPicker
                      kind="company"
                      id={company.id}
                      status={company.status}
                      meetingSetOn={meetingSet ? dayInZone(meetingSet, timeZone) : null}
                      today={today}
                    />
                  </span>
                  <span className="ml-auto">
                    <HeaderDeleteButton
                      action={deleteCompany}
                      hiddenName="companyId"
                      hiddenValue={company.id}
                      question={`Delete ${company.name} and the notes and activity on it? Its people stay, with no company.`}
                    />
                  </span>
                </>
              }
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {reachedWords && (
                  <span className="text-[var(--text-dim)]" data-testid="company-reached">
                    {reachedWords}
                  </span>
                )}
                <ShowCounts>
                  <div className="mt-2">
                    <ActivityOverview
                      notes={noteTotal}
                      personalNotes={personalNoteTotal}
                      activity={activityCounts}
                      lastTouchAt={lastTouch?.occurredAt ?? null}
                      openDealCents={openDealValue}
                      openDealCount={openDeals.length}
                      quotesOut={quotesOutTotal}
                      timeZone={timeZone}
                    />
                  </div>
                </ShowCounts>
              </div>
            </HeaderActions>
          </div>
        </header>

        {/* One column below lg that is never wider than the screen
            (Nov 10, 2026): a grid's lone implicit column grew to its widest
            content and the whole page panned sideways on a phone. */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="min-w-0 space-y-5 lg:col-span-2">
            <Card lit id="people" className="scroll-mt-4">
              <CardHeader
                title="Who to call"
                subtitle={`${peopleTotal.toLocaleString()} ${peopleTotal === 1 ? "person" : "people"} here, by stage and then how warm`}
                actions={<AddPersonSearch companyId={company.id} companyName={company.name} compact />}
              />
              <WhoToCall
                rows={rows}
                total={peopleTotal}
                page={peoplePage}
                pages={peoplePages}
                companyId={company.id}
                companyName={company.name}
                today={today}
                nudge={<OtherContacts companyId={company.id} people={companyPeople} groups={bypassGroups} />}
              />
            </Card>

            <NextStepStrip
              next={
                next
                  ? {
                      title: next.title,
                      when: `${aheadDay(next.startOn, today) === "today" ? "Today" : shortDay(next.startOn)}${next.startTime ? ` · ${time12(next.startTime)}` : ""}`,
                      href: `/dashboard/calendar?on=${next.startOn}`,
                    }
                  : health.nextText
                    ? // Booked on the Pipeline with no calendar entry of its own.
                      { title: health.nextText.charAt(0).toUpperCase() + health.nextText.slice(1), when: "", href: "/dashboard/calendar" }
                    : null
              }
              bookFor={(warmest ?? about)?.id ?? null}
            />

            <LogTouch />

            <Card lit id="activity" className="scroll-mt-4">
              <CardHeader title="History" subtitle="Everything logged here and on the people here, newest first." />
              {feed.length === 0 ? (
                <ActivityFeed items={[]} />
              ) : (
                <HistoryShell total={feed.length}>
                  {blocks.map((block, index) => (
                    <HistoryChunk key={index} tier={block.tier}>
                      {block.heading && (
                        <h3 className="border-t border-[var(--hairline-3)] px-5 pb-1 pt-3 text-xs font-semibold text-[var(--text-dim)] first:border-t-0" data-testid="history-day">
                          {dayWords(block.day)}
                        </h3>
                      )}
                      <ActivityFeed items={block.items} />
                    </HistoryChunk>
                  ))}
                </HistoryShell>
              )}
            </Card>

            <FoldCard
              id="notes"
              mode="phone"
              title="Notes"
              subtitle={`${noteTotal > notes.length ? `latest ${notes.length} of ${noteTotal.toLocaleString()}` : `${noteTotal} total`}, including everyone here`}
              testId="company-notes"
            >
              <AddNoteForm target={{ companyId: company.id }} />
              <div className="divider" />
              <NotesList
                split
                notes={notes.map((note) => ({
                  id: note.id,
                  body: note.body,
                  label: note.label,
                  authorName: note.author.name,
                  when: formatDateTime(note.createdAt, timeZone),
                  others: note.batchId ? (noteOthers.get(note.batchId) ?? 0) : 0,
                  via: note.contact,
                }))}
              />
            </FoldCard>
          </div>

          <div className="min-w-0 space-y-5">
            {opportunities.list.length > 0 && (
              <Card lit>
                <CardHeader
                  title="Opportunity"
                  subtitle={opportunities.total > 1 ? `${opportunities.total} open on the Pipeline` : "Open on the Pipeline"}
                />
                <ul className="divide-y divide-[var(--hairline-3)]" data-testid="company-opportunity">
                  {opportunities.list.map((opportunity) => (
                    <li key={opportunity.id} className="space-y-1.5 px-5 py-3.5" data-testid="opportunity-row">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-semibold">{opportunity.title}</p>
                        <span className="text-xs font-medium" data-testid="opportunity-stage">
                          {opportunity.stage}
                        </span>
                      </div>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                        <dt className="faint">Primary POC</dt>
                        <dd className="min-w-0 truncate">
                          {opportunity.primary ? (
                            <Link href={`/dashboard/contacts/${opportunity.primary.id}`} className="link" data-testid="opportunity-primary">
                              {opportunity.primary.name}
                            </Link>
                          ) : (
                            <span className="faint">Nobody yet</span>
                          )}
                        </dd>
                        {opportunity.valueCents !== null && (
                          <>
                            <dt className="faint">Value</dt>
                            <dd className="num" data-testid="opportunity-value">
                              {formatCents(opportunity.valueCents)}
                            </dd>
                          </>
                        )}
                        {opportunity.owner && (
                          <>
                            <dt className="faint">Rep</dt>
                            <dd className="min-w-0 truncate">{opportunity.owner}</dd>
                          </>
                        )}
                      </dl>
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        {opportunity.label ? <LeadLabelChip label={opportunity.label} size="xs" /> : <span />}
                        <Link
                          href={`/dashboard/deals?q=${encodeURIComponent(opportunity.primary?.name ?? company.name)}`}
                          className="link text-xs pointer-coarse:min-h-11 pointer-coarse:inline-flex pointer-coarse:items-center"
                          data-testid="opportunity-open"
                        >
                          Open on Pipeline →
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {showBalance && (
              <div id="balance" className="scroll-mt-4">
                <BalanceCard owed={balance.owed} payable={balance.payable} rows={balance.rows} timeZone={timeZone} />
              </div>
            )}

            {goodToKnow.length > 0 && (
              <Card lit>
                <CardHeader title="Good to know" actions={<a href="#notes" className="link text-xs">All notes</a>} />
                <ul className="divide-y divide-[var(--hairline-3)]" data-testid="good-to-know">
                  {goodToKnow.map((note) => (
                    <li key={note.id} className="px-5 py-3">
                      <p className="whitespace-pre-line break-words text-sm">{note.body}</p>
                      <p className="faint mt-1 text-xs">
                        {[note.label ? NOTE_LABEL_NAMES[note.label as NoteLabelValue] : null, note.contact?.name, formatDateTime(note.createdAt, timeZone)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <UpcomingCard events={upcoming} choices={eventChoices} defaults={{ companyId: company.id, startOn: today }} label={company.name} />

            {hasPaperwork && (
              <FoldCard
                mode="phone"
                title="Paperwork"
                subtitle={paperworkWords}
                testId="company-paperwork"
              >
                {deals.length > 0 && (
                  <PaperworkList title="Deals">
                    {deals.map((deal) => (
                      <li key={deal.id} className="flex items-center justify-between gap-3 px-5 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{deal.title}</p>
                          <p className="faint num text-xs">
                            {formatCents(dealValueCents(deal))} ·{" "}
                            <Link href={`/dashboard/contacts/${deal.contact.id}`} className="link">
                              {deal.contact.name}
                            </Link>
                          </p>
                        </div>
                        <DealStageBadge stage={deal.stage} />
                      </li>
                    ))}
                  </PaperworkList>
                )}
                {quotes.length > 0 && (
                  <PaperworkList title="Quotes">
                    {quotes.map((quote) => (
                      <li key={quote.id} className="px-5 py-3">
                        <Link href={`/dashboard/quotes/${quote.id}`} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium hover:underline">{quote.title}</p>
                            <p className="faint text-xs">
                              <span className="docnum">QUO-{quote.number}</span> · {quote.contact.name}
                            </p>
                          </div>
                          <StatusBadge status={quote.status} />
                        </Link>
                      </li>
                    ))}
                  </PaperworkList>
                )}
                {contracts.length > 0 && (
                  <PaperworkList title="Contracts">
                    {contracts.map((contract) => (
                      <li key={contract.id} className="px-5 py-3">
                        <Link href={`/dashboard/contracts/${contract.id}`} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium hover:underline">{contract.title}</p>
                            <p className="faint text-xs">
                              <span className="docnum">CON-{contract.number}</span> · {contract.contact.name}
                            </p>
                          </div>
                          <StatusBadge status={contract.status} />
                        </Link>
                      </li>
                    ))}
                  </PaperworkList>
                )}
              </FoldCard>
            )}

            <ProjectsCard projects={projects} />

            <FoldCard
              mode="closed"
              defaultOpen={company.autoFilled.length > 0}
              title="Details"
              subtitle={company.autoFilled.length > 0 ? "Values marked “auto” were filled in by the app." : "Phone, email, website, industry and where"}
              actions={company.autoFilled.length > 0 ? <LooksRightButton companyId={company.id} /> : undefined}
              testId="company-details"
            >
              <dl className="space-y-3 p-5 text-sm">
                <Detail
                  label="Industry · Type"
                  value={
                    company.industries.length || company.companyTypes.length ? (
                      <span className="inline-flex flex-wrap items-center justify-end gap-1">
                        <TagCell industries={company.industries} types={company.companyTypes} />
                        <AutoPill field="industries" autoFilled={company.autoFilled} enrichedAt={company.enrichedAt} timeZone={timeZone} />
                      </span>
                    ) : null
                  }
                />
                <Detail
                  label="Phone"
                  value={
                    company.phone ? (
                      <>
                        <a href={`tel:${company.phone}`} className="link num">
                          {company.phone}
                        </a>
                        <AutoPill field="phone" autoFilled={company.autoFilled} enrichedAt={company.enrichedAt} timeZone={timeZone} />
                      </>
                    ) : null
                  }
                />
                <Detail
                  label="Email"
                  value={
                    company.email ? (
                      <a href={`mailto:${company.email}`} className="link">
                        {company.email}
                      </a>
                    ) : null
                  }
                />
                <Detail
                  label="Website"
                  value={
                    company.website ? (
                      <>
                        <a href={company.website} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1">
                          <IconGlobe size={12} />
                          {company.website.replace(/^https?:\/\//, "")}
                        </a>
                        <AutoPill field="website" autoFilled={company.autoFilled} enrichedAt={company.enrichedAt} timeZone={timeZone} />
                      </>
                    ) : null
                  }
                />
                <Detail label="Added" value={<AddedBy name={company.createdBy?.name ?? null} at={company.createdAt} timeZone={timeZone} />} />
                <Detail label="City" value={company.city} />
                <Detail label="State" value={company.state} />
              </dl>
            </FoldCard>
          </div>
        </div>

        <PhoneBar mainLine={company.phone} bookFor={(warmest ?? about)?.id ?? null} />
      </CompanyShell>
    </div>
  );
}

function PaperworkList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[var(--hairline-3)] last:border-b-0">
      <h3 className="faint px-5 pt-3 text-xs font-semibold">{title}</h3>
      <ul className="divide-y divide-[var(--hairline-3)]">{children}</ul>
    </section>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode | null | undefined;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="faint shrink-0 text-xs">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm">
        {value || <span className="faint">—</span>}
      </dd>
    </div>
  );
}
