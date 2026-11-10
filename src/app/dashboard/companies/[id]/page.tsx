import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { formatCents, formatDateTime } from "@/lib/format";
import { ACTIVITY_TYPES, OPEN_DEAL_STAGES, PERSONAL_NOTE_LABELS, type ActivityTypeValue } from "@/lib/constants";
import { dealValueCents, isOpenStage, QUOTES_FOR_VALUE } from "@/lib/deals";
import { batchOthers } from "@/lib/logging";
import {
  PageHeader,
  Card,
  CardHeader,
  BackLink,
  StatusBadge,
  DealStageBadge,
  EmptyState,
} from "@/components/ui";
import { IconGlobe, IconChevronLeft, IconChevronRight } from "@/components/icons";
import { StarButton } from "@/components/star-button";
import { AutoPill } from "@/components/auto-pill";
import { TagCell } from "../../contacts/contacts-list";
import { deleteCompany, setCompanyFavorite } from "../actions";
import { HeaderDeleteButton } from "@/components/header-delete-button";
import { StatusPicker } from "@/components/status-picker";
import { meetingSetDay } from "@/lib/status";
import { dayInZone } from "@/lib/calendar-auto";
import { AddPersonSearch } from "@/components/add-person-search";
import { LooksRightButton } from "./looks-right-button";
import { ActivityOverview } from "@/components/activity-overview";
import { BalanceCard } from "@/components/balance-card";
import { ProjectsCard } from "@/components/projects-card";
import { UpcomingCard } from "@/components/upcoming-card";
import { loadEventChoices, upcomingFor } from "@/lib/calendar-data";
import { loadBalance } from "@/lib/money";
import { todayIso } from "@/lib/payments";
import { Avatar } from "@/components/avatar";
import { ActivityFeed } from "@/components/activity-feed";
import { NotesList } from "@/components/notes-list";
import { AddNoteForm, LogActivityForm } from "../../contacts/[id]/forms";
import { OtherContacts, type BypassGroup } from "@/components/other-contacts";
import { AddedBy } from "@/components/crm-cells";
import { RepPicker } from "@/components/rep-select";
import { loadRepChoices } from "@/lib/reps";

// A company can have thousands of people and years of activity, so the
// page shows the people fifty at a time and the latest slice of every
// feed, with counts for the rest.
const PEOPLE_PER_PAGE = 50;
const FEED_LIMIT = 200;

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

  const timeZone = await getTimeZone();

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
  const people = await prisma.contact.findMany({
    where: { organizationId, OR: [{ companyId: company.id }, ...(linkedIds.length ? [{ id: { in: linkedIds } }] : [])] },
    orderBy: [{ favorite: "desc" }, { name: "asc" }],
    skip: (peoplePage - 1) * PEOPLE_PER_PAGE,
    take: PEOPLE_PER_PAGE,
    select: { id: true, name: true, title: true, email: true, phone: true, mobile: true, status: true, favorite: true, companyId: true },
  });

  // Everything logged on the company itself, plus everything logged on
  // its people, in one feed. `via` says which person an entry came from.
  const viaPeople = { contact: { companyId: company.id } };
  const [notes, activities, deals, quotes, contracts] = await Promise.all([
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
  ]);

  // Totals come from their own count queries, so a company with more
  // history than the feeds show still reads the right numbers.
  const [noteOthers, activityOthers, noteTotal, personalNoteTotal, activityByType, dealTotal, quotesOutTotal, openDealRows] =
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
    ]);

  const today = todayIso(timeZone);
  const meetingSet = await meetingSetDay(organizationId, { companyId: company.id });

  // Other Contacts: what was logged here with nobody linked, newest
  // first, grouped under whoever bypassed, for claiming.
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

  // The pickers' hover line shows a number; someone with only a mobile
  // on file has that one.
  const companyPeople = people.map((person) => ({ id: person.id, name: person.name, email: person.email, phone: person.phone ?? person.mobile }));

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

  return (
    <div>
      <BackLink href="/dashboard/companies" label="Companies" current={company.name} />

      <PageHeader
        eyebrow="Company"
        title={company.name}
        subtitle={[company.city, company.state].filter(Boolean).join(", ") || undefined}
        leading={<Avatar url={company.logoUrl} name={company.name} size={56} />}
        actions={
          <>
            <StarButton id={company.id} favorite={company.favorite} action={setCompanyFavorite} label={company.name} size={18} />
            <StatusPicker
              kind="company"
              id={company.id}
              status={company.status}
              meetingSetOn={meetingSet ? dayInZone(meetingSet, timeZone) : null}
              today={today}
            />
            <AddPersonSearch companyId={company.id} companyName={company.name} />
            <Link
              href={`/dashboard/companies/${company.id}/edit`}
              className="btn btn-ghost btn-sm"
            >
              Edit
            </Link>
            <HeaderDeleteButton
              action={deleteCompany}
              hiddenName="companyId"
              hiddenValue={company.id}
              question={`Delete ${company.name} and the notes and activity on it? Its people stay, with no company.`}
            />
          </>
        }
      />

      {/* One column below lg that is never wider than the screen
          (Nov 10, 2026): a grid's lone implicit column grew to its widest
          content and the whole page panned sideways on a phone. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card lit id="activity">
            <CardHeader
              title="Log activity"
              subtitle="An activity here is with a person at this company. Everything logged on its people rolls up below too."
            />
            <LogActivityForm
              target={{ companyId: company.id }}
              companyPeople={companyPeople}
              userName={userName}
              today={today}
            />
            <div className="divider" />
            <ActivityFeed
              items={feed.map((activity) => ({
                id: activity.id,
                type: activity.type,
                body: activity.body,
                userName: activity.user.name,
                when: formatDateTime(activity.occurredAt, timeZone),
                // Copies on people not on this page (another company's,
                // or past the feed's last row) are still "also on N".
                others: activity.batchId ? Math.max(0, (activityOthers.get(activity.batchId) ?? 0) + 1 - activity.people.length) : 0,
                via: activity.people.length ? activity.people : null,
                bypassedBy: activity.contact ? null : activity.user.name,
                marketing: activity.marketing,
              }))}
            />
          </Card>

          <Card lit id="notes">
            <CardHeader
              title="Notes"
              subtitle={`${noteTotal > notes.length ? `latest ${notes.length} of ${noteTotal.toLocaleString()}` : `${noteTotal} total`}, including everyone here`}
            />
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
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card lit>
            <CardHeader
              title="Details"
              subtitle={company.autoFilled.length > 0 ? "Values marked “auto” were filled in by the app." : undefined}
              actions={company.autoFilled.length > 0 ? <LooksRightButton companyId={company.id} /> : undefined}
            />
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
                      <a
                        href={company.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link inline-flex items-center gap-1"
                      >
                        <IconGlobe size={12} />
                        {company.website.replace(/^https?:\/\//, "")}
                      </a>
                      <AutoPill field="website" autoFilled={company.autoFilled} enrichedAt={company.enrichedAt} timeZone={timeZone} />
                    </>
                  ) : null
                }
              />
              <Detail label="Rep" value={<RepPicker kind="company" id={company.id} ownerId={company.ownerId} reps={reps} />} />
              <Detail label="Added" value={<AddedBy name={company.createdBy?.name ?? null} at={company.createdAt} timeZone={timeZone} />} />
              <Detail label="City" value={company.city} />
              <Detail label="State" value={company.state} />
            </dl>
          </Card>

          <BalanceCard
            owed={balance.owed}
            payable={balance.payable}
            rows={balance.rows}
            timeZone={timeZone}
          />

          <ProjectsCard projects={projects} />

          <UpcomingCard
            events={upcoming}
            choices={eventChoices}
            defaults={{ companyId: company.id, startOn: today }}
            label={company.name}
          />

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

          <Card lit id="people">
            <CardHeader
              title="People"
              subtitle={`${peopleTotal.toLocaleString()} at this company`}
              actions={<AddPersonSearch companyId={company.id} companyName={company.name} compact />}
            />
            {people.length === 0 ? (
              <EmptyState
                title="Nobody here yet"
                body="Add the person you actually talk to, and their quotes and deals show up on this page."
              />
            ) : (
              <ul className="divide-y divide-[var(--hairline)]">
                {people.map((person) => {
                  // Their numbers, each one a tap to call (Nov 10, 2026): a
                  // person with only a mobile on file showed no number.
                  const numbers = [
                    person.phone ? { label: "", number: person.phone } : null,
                    person.mobile ? { label: "Mobile ", number: person.mobile } : null,
                  ].filter((entry) => entry !== null);
                  const parts = [
                    person.title,
                    ...numbers.map(({ label, number }) => (
                      <a key={`${label}${number}`} href={`tel:${number}`} className="link num relative z-10" data-testid="person-call">
                        {label}
                        {number}
                      </a>
                    )),
                    person.email,
                  ].filter(Boolean);
                  return (
                    // The name's link covers the whole row, as the row link
                    // did; the numbers sit above it so a tap on one calls.
                    <li key={person.id} className="relative flex items-center justify-between gap-3 px-5 py-3" data-testid="person-row">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          <Link href={`/dashboard/contacts/${person.id}`} className="after:absolute after:inset-0 hover:underline">
                            {person.favorite && <span className="mr-1 text-[var(--warn)]">★</span>}
                            {person.name}
                          </Link>
                          {person.companyId !== company.id && (
                            <span className="badge ml-2 border-[var(--border)] text-[0.62rem] text-[var(--text-faint)]" data-testid="linked-person">
                              Additional account
                            </span>
                          )}
                        </p>
                        <p className="faint truncate text-xs">
                          {parts.length
                            ? parts.map((part, index) => (
                                <Fragment key={index}>
                                  {index > 0 && " · "}
                                  {part}
                                </Fragment>
                              ))
                            : "—"}
                        </p>
                      </div>
                      <StatusBadge status={person.status} />
                    </li>
                  );
                })}
              </ul>
            )}
            <OtherContacts companyId={company.id} people={companyPeople} groups={bypassGroups} />
            {peoplePages > 1 && (
              <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-2.5 text-xs">
                <span className="faint">
                  Page {peoplePage} of {peoplePages}
                </span>
                <span className="flex gap-1">
                  {peoplePage > 1 ? (
                    <Link href={`/dashboard/companies/${company.id}?people=${peoplePage - 1}#people`} className="btn btn-ghost btn-sm" aria-label="Previous people">
                      <IconChevronLeft size={13} />
                    </Link>
                  ) : (
                    <span className="btn btn-ghost btn-sm pointer-events-none opacity-40"><IconChevronLeft size={13} /></span>
                  )}
                  {peoplePage < peoplePages ? (
                    <Link href={`/dashboard/companies/${company.id}?people=${peoplePage + 1}#people`} className="btn btn-ghost btn-sm" aria-label="Next people">
                      <IconChevronRight size={13} />
                    </Link>
                  ) : (
                    <span className="btn btn-ghost btn-sm pointer-events-none opacity-40"><IconChevronRight size={13} /></span>
                  )}
                </span>
              </div>
            )}
          </Card>

          <Card lit>
            <CardHeader title="Deals" subtitle={`${dealTotal > deals.length ? `latest ${deals.length} of ${dealTotal.toLocaleString()}` : dealTotal} across everyone here`} />
            {deals.length === 0 ? (
              <EmptyState title="No deals yet" body="Deals and quotes are started from a person's page." />
            ) : (
              <ul className="divide-y divide-[var(--hairline)]">
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
              </ul>
            )}
          </Card>

          <Card lit>
            <CardHeader title="Quotes" />
            {quotes.length === 0 ? (
              <EmptyState title="No quotes yet" />
            ) : (
              <ul className="divide-y divide-[var(--hairline)]">
                {quotes.map((quote) => (
                  <li key={quote.id} className="px-5 py-3">
                    <Link
                      href={`/dashboard/quotes/${quote.id}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium hover:underline">{quote.title}</p>
                        <p className="faint num text-xs">
                          QUO-{quote.number} · {quote.contact.name}
                        </p>
                      </div>
                      <StatusBadge status={quote.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card lit>
            <CardHeader title="Contracts" />
            {contracts.length === 0 ? (
              <EmptyState title="No contracts yet" />
            ) : (
              <ul className="divide-y divide-[var(--hairline)]">
                {contracts.map((contract) => (
                  <li key={contract.id} className="px-5 py-3">
                    <Link
                      href={`/dashboard/contracts/${contract.id}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium hover:underline">{contract.title}</p>
                        <p className="faint num text-xs">
                          CON-{contract.number} · {contract.contact.name}
                        </p>
                      </div>
                      <StatusBadge status={contract.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
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
