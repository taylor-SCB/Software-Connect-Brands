import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getTimeZone } from "@/lib/organization";
import { formatCents, formatDateTime, formatDate } from "@/lib/format";
import { ACTIVITY_TYPES, isPersonalLabel, type ActivityTypeValue } from "@/lib/constants";
import { dealValueCents, isOpenStage, QUOTES_FOR_VALUE } from "@/lib/deals";
import { batchOthers } from "@/lib/logging";
import {
  PageHeader,
  Card,
  CardHeader,
  BackLink,
  StatusBadge,
  EmptyState,
} from "@/components/ui";
import { IconGlobe, IconUserPlus, IconPlus } from "@/components/icons";
import { ActivityOverview } from "@/components/activity-overview";
import { ActivityFeed } from "@/components/activity-feed";
import { NotesList } from "@/components/notes-list";
import { AddNoteForm, LogActivityForm } from "../../contacts/[id]/forms";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await requireSession();

  const timeZone = await getTimeZone();

  const company = await prisma.company.findFirst({
    where: { id, organizationId },
    include: {
      contacts: {
        orderBy: { name: "asc" },
        select: { id: true, name: true, title: true, email: true, phone: true, status: true },
      },
    },
  });
  if (!company) notFound();

  // Everything logged on the company itself, plus everything logged on
  // its people, in one feed. `via` says which person an entry came from.
  const viaPeople = { contact: { companyId: company.id } };
  const [notes, activities, deals, quotes, contracts] = await Promise.all([
    prisma.note.findMany({
      where: { organizationId, OR: [{ companyId: company.id }, viaPeople] },
      orderBy: { createdAt: "desc" },
      include: {
        author: { select: { name: true } },
        contact: { select: { id: true, name: true } },
      },
    }),
    prisma.activity.findMany({
      where: { organizationId, OR: [{ companyId: company.id }, viaPeople] },
      orderBy: { occurredAt: "desc" },
      include: {
        user: { select: { name: true } },
        contact: { select: { id: true, name: true } },
      },
    }),
    prisma.deal.findMany({
      where: { organizationId, ...viaPeople },
      orderBy: { createdAt: "desc" },
      include: {
        contact: { select: { id: true, name: true } },
        quotes: QUOTES_FOR_VALUE,
        _count: { select: { quotes: true } },
      },
    }),
    prisma.quote.findMany({
      where: { organizationId, ...viaPeople },
      orderBy: { createdAt: "desc" },
      include: { contact: { select: { name: true } }, deal: { select: { title: true } } },
    }),
    prisma.contract.findMany({
      where: { organizationId, ...viaPeople },
      orderBy: { createdAt: "desc" },
      include: { contact: { select: { name: true } } },
    }),
  ]);

  const [noteOthers, activityOthers] = await Promise.all([
    batchOthers("note", notes.map((note) => note.batchId)),
    batchOthers("activity", activities.map((activity) => activity.batchId)),
  ]);

  const activityCounts = ACTIVITY_TYPES.reduce(
    (acc, type) => {
      acc[type] = activities.filter((a) => a.type === type).length;
      return acc;
    },
    {} as Record<ActivityTypeValue, number>,
  );
  const openDeals = deals.filter((deal) => isOpenStage(deal.stage));
  const openDealValue = openDeals.reduce((sum, deal) => sum + dealValueCents(deal), 0);

  return (
    <div>
      <BackLink href="/dashboard/companies" label="Companies" current={company.name} />

      <PageHeader
        eyebrow="Company"
        title={company.name}
        subtitle={[company.city, company.state].filter(Boolean).join(", ") || undefined}
        actions={
          <>
            <StatusBadge status={company.status} />
            <Link
              href={`/dashboard/contacts/new?companyId=${company.id}`}
              className="btn btn-ghost btn-sm"
            >
              <IconUserPlus size={13} />
              Add person
            </Link>
            <Link
              href={`/dashboard/companies/${company.id}/edit`}
              className="btn btn-ghost btn-sm"
            >
              Edit
            </Link>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card lit id="activity">
            <CardHeader
              title="Log activity"
              subtitle="Logged here it sits on the company. Activity on its people rolls up below too."
            />
            <LogActivityForm target={{ companyId: company.id }} />
            <div className="divider" />
            <ActivityFeed
              items={activities.map((activity) => ({
                id: activity.id,
                type: activity.type,
                body: activity.body,
                userName: activity.user.name,
                when: formatDateTime(activity.occurredAt, timeZone),
                others: activity.batchId ? (activityOthers.get(activity.batchId) ?? 0) : 0,
                via: activity.contact,
              }))}
            />
          </Card>

          <Card lit id="notes">
            <CardHeader title="Notes" subtitle={`${notes.length} total, including everyone here`} />
            <AddNoteForm target={{ companyId: company.id }} />
            <div className="divider" />
            <NotesList
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

        <div className="space-y-5">
          <Card lit>
            <CardHeader title="Details" />
            <dl className="space-y-3 p-5 text-sm">
              <Detail
                label="Phone"
                value={
                  company.phone ? (
                    <a href={`tel:${company.phone}`} className="link num">
                      {company.phone}
                    </a>
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
                    <a
                      href={company.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link inline-flex items-center gap-1"
                    >
                      <IconGlobe size={12} />
                      {company.website.replace(/^https?:\/\//, "")}
                    </a>
                  ) : null
                }
              />
              <Detail label="Added" value={formatDate(company.createdAt, timeZone)} />
              <Detail label="City" value={company.city} />
              <Detail label="State" value={company.state} />
            </dl>
          </Card>

          <ActivityOverview
            notes={notes.length}
            personalNotes={notes.filter((note) => isPersonalLabel(note.label)).length}
            activity={activityCounts}
            lastTouchAt={activities[0]?.occurredAt ?? null}
            openDealCents={openDealValue}
            openDealCount={openDeals.length}
            quotesOut={quotes.filter((quote) => quote.status === "SENT").length}
            timeZone={timeZone}
          />

          <Card lit id="people">
            <CardHeader
              title="People"
              subtitle={`${company.contacts.length} at this company`}
              actions={
                <Link
                  href={`/dashboard/contacts/new?companyId=${company.id}`}
                  className="btn btn-ghost btn-sm"
                >
                  <IconPlus size={12} />
                  Add
                </Link>
              }
            />
            {company.contacts.length === 0 ? (
              <EmptyState
                title="Nobody here yet"
                body="Add the person you actually talk to, and their quotes and deals show up on this page."
              />
            ) : (
              <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
                {company.contacts.map((person) => (
                  <li key={person.id} className="px-5 py-3">
                    <Link
                      href={`/dashboard/contacts/${person.id}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium hover:underline">
                          {person.name}
                        </p>
                        <p className="faint truncate text-xs">
                          {[person.title, person.phone, person.email].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>
                      <StatusBadge status={person.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card lit>
            <CardHeader title="Deals" subtitle={`${deals.length} across everyone here`} />
            {deals.length === 0 ? (
              <EmptyState title="No deals yet" body="Deals and quotes are started from a person's page." />
            ) : (
              <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
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
                    <StatusBadge status={deal.stage} />
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
              <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
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
              <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
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
