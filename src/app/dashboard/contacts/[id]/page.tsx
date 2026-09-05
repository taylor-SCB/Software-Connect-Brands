import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents, formatDateTime, formatDate } from "@/lib/format";
import {
  ACTIVITY_LABELS,
  ACTIVITY_TYPES,
  type ActivityTypeValue,
} from "@/lib/constants";
import {
  PageHeader,
  Card,
  CardHeader,
  BackLink,
  StatusBadge,
  EmptyState,
} from "@/components/ui";
import {
  IconMessage,
  IconMail,
  IconPhone,
  IconCalendar,
  IconGlobe,
  IconNote,
  IconFileText,
  IconSignature,
  IconPlus,
} from "@/components/icons";
import { AddNoteForm, LogActivityForm, AddDealForm } from "./forms";

const ACTIVITY_ICONS = {
  TEXT: IconMessage,
  EMAIL: IconMail,
  PHONE_CALL: IconPhone,
  MEETING: IconCalendar,
} as const;

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await requireSession();

  const contact = await prisma.contact.findFirst({
    where: { id, organizationId },
    include: {
      deals: { orderBy: { createdAt: "desc" } },
      notes: {
        orderBy: { createdAt: "desc" },
        include: { author: { select: { name: true } } },
      },
      activities: {
        orderBy: { occurredAt: "desc" },
        include: { user: { select: { name: true } } },
      },
      quotes: { orderBy: { createdAt: "desc" } },
      contracts: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!contact) notFound();

  const activityCounts = ACTIVITY_TYPES.reduce(
    (acc, type) => {
      acc[type] = contact.activities.filter((a) => a.type === type).length;
      return acc;
    },
    {} as Record<ActivityTypeValue, number>,
  );

  const openDealValue = contact.deals
    .filter((deal) => deal.stage === "NEW" || deal.stage === "CONTACTED")
    .reduce((sum, deal) => sum + deal.valueCents, 0);

  return (
    <div>
      <BackLink href="/dashboard/contacts" label="Contacts" />

      <PageHeader
        eyebrow={contact.company ?? "Contact"}
        title={contact.name}
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

      {/* Counters mirror the contacts list so the numbers reconcile. */}
      <div className="mb-6 flex flex-wrap gap-2">
        <a
          href="#notes"
          className="card card-hover flex items-center gap-2 px-3 py-2 text-xs"
        >
          <IconNote size={14} className="text-[var(--brand)]" />
          <span className="num font-semibold">{contact.notes.length}</span>
          <span className="faint">Notes</span>
        </a>
        {ACTIVITY_TYPES.map((type) => {
          const Icon = ACTIVITY_ICONS[type];
          return (
            <a
              key={type}
              href="#activity"
              className="card card-hover flex items-center gap-2 px-3 py-2 text-xs"
            >
              <Icon size={14} className="text-[var(--brand)]" />
              <span className="num font-semibold">{activityCounts[type]}</span>
              <span className="faint">{ACTIVITY_LABELS[type]}</span>
            </a>
          );
        })}
        {openDealValue > 0 && (
          <div className="card flex items-center gap-2 px-3 py-2 text-xs">
            <span className="num font-semibold">{formatCents(openDealValue)}</span>
            <span className="faint">Open pipeline</span>
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card lit id="activity">
            <CardHeader
              title="Log activity"
              subtitle="Every touchpoint is counted by type on this contact."
            />
            <LogActivityForm contactId={contact.id} />
            <div className="divider" />
            {contact.activities.length === 0 ? (
              <EmptyState title="No activity yet" body="Log a call, text, email or meeting to build the history." />
            ) : (
              <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
                {contact.activities.map((activity) => {
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
                        <p className="text-sm leading-relaxed">{activity.body}</p>
                        <p className="faint mt-1 text-[0.7rem]">
                          {ACTIVITY_LABELS[activity.type as ActivityTypeValue]} ·{" "}
                          {activity.user.name} · {formatDateTime(activity.occurredAt)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card lit id="notes">
            <CardHeader title="Notes" subtitle={`${contact.notes.length} total`} />
            <AddNoteForm contactId={contact.id} />
            <div className="divider" />
            {contact.notes.length === 0 ? (
              <EmptyState title="No notes yet" />
            ) : (
              <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
                {contact.notes.map((note) => (
                  <li key={note.id} className="px-5 py-3">
                    <p className="text-sm leading-relaxed">{note.body}</p>
                    <p className="faint mt-1 text-[0.7rem]">
                      {note.author.name} · {formatDateTime(note.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card lit>
            <CardHeader title="Details" />
            <dl className="space-y-3 p-5 text-sm">
              <Detail label="Company" value={contact.company} />
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
              <Detail label="Added" value={formatDate(contact.createdAt)} />
            </dl>
          </Card>

          <Card lit>
            <CardHeader title="Deals" subtitle={`${contact.deals.length} total`} />
            <AddDealForm contactId={contact.id} />
            <div className="divider" />
            {contact.deals.length === 0 ? (
              <EmptyState title="No deals yet" />
            ) : (
              <ul className="divide-y divide-[rgb(255_255_255/0.045)]">
                {contact.deals.map((deal) => (
                  <li
                    key={deal.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{deal.title}</p>
                      <p className="faint num text-xs">{formatCents(deal.valueCents)}</p>
                    </div>
                    <StatusBadge status={deal.stage} />
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
                        <p className="faint num text-xs">QUO-{quote.number}</p>
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
