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
import {
  IconGlobe,
  IconFileText,
  IconSignature,
  IconPlus,
  IconBuilding,
} from "@/components/icons";
import { ActivityOverview } from "@/components/activity-overview";
import { Avatar } from "@/components/avatar";
import { ActivityFeed } from "@/components/activity-feed";
import { NotesList } from "@/components/notes-list";
import { AddNoteForm, LogActivityForm, AddDealForm } from "./forms";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await requireSession();

  const timeZone = await getTimeZone();

  const [contact, allContacts] = await Promise.all([
    prisma.contact.findFirst({
      where: { id, organizationId },
      include: {
        company: { select: { id: true, name: true } },
        deals: {
          orderBy: { createdAt: "desc" },
          include: { quotes: QUOTES_FOR_VALUE, _count: { select: { quotes: true } } },
        },
        notes: {
          orderBy: { createdAt: "desc" },
          include: { author: { select: { name: true } } },
        },
        activities: {
          orderBy: { occurredAt: "desc" },
          include: { user: { select: { name: true } } },
        },
        quotes: {
          orderBy: { createdAt: "desc" },
          include: { deal: { select: { title: true } } },
        },
        contracts: { orderBy: { createdAt: "desc" } },
      },
    }),
    // For "+ Include multiple contacts". Every row, like every other list
    // in the app today.
    prisma.contact.findMany({
      where: { organizationId, status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, company: { select: { name: true } } },
    }),
  ]);

  if (!contact) notFound();

  const [noteOthers, activityOthers] = await Promise.all([
    batchOthers("note", contact.notes.map((note) => note.batchId)),
    batchOthers("activity", contact.activities.map((activity) => activity.batchId)),
  ]);

  const activityCounts = ACTIVITY_TYPES.reduce(
    (acc, type) => {
      acc[type] = contact.activities.filter((a) => a.type === type).length;
      return acc;
    },
    {} as Record<ActivityTypeValue, number>,
  );

  const openDeals = contact.deals.filter((deal) => isOpenStage(deal.stage));
  const openDealValue = openDeals.reduce((sum, deal) => sum + dealValueCents(deal), 0);
  const quotesOut = contact.quotes.filter((quote) => quote.status === "SENT").length;
  const lastTouchAt = contact.activities[0]?.occurredAt ?? null;

  const pickable = allContacts.map((row) => ({
    id: row.id,
    name: row.name,
    company: row.company?.name ?? null,
  }));

  return (
    <div>
      <BackLink href="/dashboard/contacts" label="Contacts" current={contact.name} />

      <PageHeader
        eyebrow={contact.company?.name ?? "Contact"}
        title={contact.name}
        subtitle={contact.title ?? undefined}
        leading={<Avatar url={contact.imageUrl} name={contact.name} size={56} round />}
        actions={
          <>
            <StatusBadge status={contact.status} />
            <Link
              href={`/dashboard/quotes/new?contactId=${contact.id}`}
              className="btn btn-ghost btn-sm"
            >
              <IconFileText size={13} />
              New quote
            </Link>
            <Link
              href={`/dashboard/contracts/new?contactId=${contact.id}`}
              className="btn btn-ghost btn-sm"
            >
              <IconSignature size={13} />
              New contract
            </Link>
            <Link
              href={`/dashboard/contacts/${contact.id}/edit`}
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
              subtitle="Every touchpoint is counted by type on this contact."
            />
            <LogActivityForm target={{ contactId: contact.id }} contacts={pickable} />
            <div className="divider" />
            <ActivityFeed
              items={contact.activities.map((activity) => ({
                id: activity.id,
                type: activity.type,
                body: activity.body,
                userName: activity.user.name,
                when: formatDateTime(activity.occurredAt, timeZone),
                others: activity.batchId ? (activityOthers.get(activity.batchId) ?? 0) : 0,
              }))}
            />
          </Card>

          <Card lit id="notes">
            <CardHeader title="Notes" subtitle={`${contact.notes.length} total`} />
            <AddNoteForm target={{ contactId: contact.id }} contacts={pickable} />
            <div className="divider" />
            <NotesList
              notes={contact.notes.map((note) => ({
                id: note.id,
                body: note.body,
                label: note.label,
                authorName: note.author.name,
                when: formatDateTime(note.createdAt, timeZone),
                others: note.batchId ? (noteOthers.get(note.batchId) ?? 0) : 0,
              }))}
            />
          </Card>
        </div>

        <div className="space-y-5">
          <Card lit>
            <CardHeader title="Details" />
            <dl className="space-y-3 p-5 text-sm">
              <Detail
                label="Company"
                value={
                  contact.company ? (
                    <Link
                      href={`/dashboard/companies/${contact.company.id}`}
                      className="link inline-flex items-center gap-1"
                    >
                      <IconBuilding size={12} />
                      {contact.company.name}
                    </Link>
                  ) : null
                }
              />
              <Detail label="Title" value={contact.title} />
              <Detail
                label="Email"
                value={
                  contact.email ? (
                    <a href={`mailto:${contact.email}`} className="link">
                      {contact.email}
                    </a>
                  ) : null
                }
              />
              <Detail
                label="Phone"
                value={
                  contact.phone ? (
                    <a href={`tel:${contact.phone}`} className="link num">
                      {contact.phone}
                    </a>
                  ) : null
                }
              />
              <Detail
                label="Website"
                value={
                  contact.website ? (
                    <a
                      href={contact.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link inline-flex items-center gap-1"
                    >
                      <IconGlobe size={12} />
                      {contact.website.replace(/^https?:\/\//, "")}
                    </a>
                  ) : null
                }
              />
              <Detail
                label="Birthday"
                value={contact.birthday ? formatDate(contact.birthday, "UTC") : null}
              />
              <Detail label="Added" value={formatDate(contact.createdAt, timeZone)} />
              <Detail label="City" value={contact.city} />
              <Detail label="State" value={contact.state} />
            </dl>
          </Card>

          <ActivityOverview
            notes={contact.notes.length}
            personalNotes={contact.notes.filter((note) => isPersonalLabel(note.label)).length}
            activity={activityCounts}
            lastTouchAt={lastTouchAt}
            openDealCents={openDealValue}
            openDealCount={openDeals.length}
            quotesOut={quotesOut}
            timeZone={timeZone}
          />

          <Card lit>
            <CardHeader
              title="Deals"
              subtitle={`${contact.deals.length} total · a deal is one job you're chasing`}
            />
            <AddDealForm contactId={contact.id} />
            <div className="divider" />
            {contact.deals.length === 0 ? (
              <EmptyState title="No deals yet" body="Creating a quote adds one automatically." />
            ) : (
              <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
                {contact.deals.map((deal) => (
                  <li
                    key={deal.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{deal.title}</p>
                      <p className="faint num text-xs">
                        {formatCents(dealValueCents(deal))}
                        {" · "}
                        {deal._count.quotes} {deal._count.quotes === 1 ? "quote" : "quotes"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusBadge status={deal.stage} />
                      <Link
                        href={`/dashboard/quotes/new?contactId=${contact.id}&dealId=${deal.id}`}
                        className="btn btn-ghost btn-sm"
                        title="New quote on this deal"
                      >
                        <IconPlus size={12} />
                        Quote
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card lit>
            <CardHeader
              title="Quotes"
              actions={
                <Link
                  href={`/dashboard/quotes/new?contactId=${contact.id}`}
                  className="btn btn-ghost btn-sm"
                >
                  <IconPlus size={12} />
                  New
                </Link>
              }
            />
            {contact.quotes.length === 0 ? (
              <EmptyState title="No quotes yet" />
            ) : (
              <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
                {contact.quotes.map((quote) => (
                  <li key={quote.id} className="px-5 py-3">
                    <Link
                      href={`/dashboard/quotes/${quote.id}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium hover:underline">
                          {quote.title}
                        </p>
                        <p className="faint num text-xs">
                          QUO-{quote.number} · {quote.deal.title}
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
            <CardHeader
              title="Contracts"
              actions={
                <Link
                  href={`/dashboard/contracts/new?contactId=${contact.id}`}
                  className="btn btn-ghost btn-sm"
                >
                  <IconPlus size={12} />
                  New
                </Link>
              }
            />
            {contact.contracts.length === 0 ? (
              <EmptyState title="No contracts yet" />
            ) : (
              <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
                {contact.contracts.map((contract) => (
                  <li key={contract.id} className="px-5 py-3">
                    <Link
                      href={`/dashboard/contracts/${contract.id}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium hover:underline">
                          {contract.title}
                        </p>
                        <p className="faint num text-xs">CON-{contract.number}</p>
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
