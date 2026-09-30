import Link from "next/link";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents, formatDate } from "@/lib/format";
import {
  BOARD_DEAL_STAGES,
  CONTACT_COLUMNS,
  PIPELINE_COLUMNS,
  PIPELINE_COLUMN_COLORS,
  PIPELINE_COLUMN_LABELS,
  type PipelineColumn,
} from "@/lib/constants";
import { dealValueCents, isOpenStage, QUOTES_FOR_VALUE } from "@/lib/deals";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { IconTrending, IconFileText, IconPlus, IconClock, IconCalendar } from "@/components/icons";
import { StatusPicker } from "@/components/status-picker";
import { loadWorkspaceUsers } from "@/lib/workspace-users";
import { getTimeZone } from "@/lib/organization";
import { todayIso } from "@/lib/payments";
import { dayInZone } from "@/lib/calendar-auto";
import { sweepStaleContracts } from "@/lib/status";
import { StageSelect } from "./stage-select";
import { OwnerSelect } from "./owner-select";

// How many contact cards a meeting column shows before saying "and N more".
const CONTACTS_PER_COLUMN = 100;

// The Pipeline (Sept 30, 2026): it starts at Meeting Set. The first two
// columns are contacts whose status is Meeting Set or Meeting Completed —
// a meeting is not a deal. From Quote Sent on, the cards are deals, which
// are for quotes and contracts. A person moves from the meeting columns to
// the deal columns when their quote goes out, so nobody is on it twice.
export default async function DealsPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const { organizationId } = await requireSession();
  const { archived } = await searchParams;
  const showArchived = archived === "1";
  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);

  // The app's own clock for the 90 / 180-day contract rule.
  await sweepStaleContracts(organizationId);

  const [deals, users, meetingContacts, meetingCounts, lostContacts, archivedCount] = await Promise.all([
    prisma.deal.findMany({
      where: { organizationId, stage: { in: showArchived ? [...BOARD_DEAL_STAGES, "ARCHIVED"] : [...BOARD_DEAL_STAGES] } },
      orderBy: { updatedAt: "desc" },
      include: {
        contact: { select: { id: true, name: true, company: { select: { name: true } } } },
        quotes: {
          select: { ...QUOTES_FOR_VALUE.select, id: true, number: true, title: true },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    loadWorkspaceUsers(organizationId),
    prisma.contact.findMany({
      where: { organizationId, status: { in: [...CONTACT_COLUMNS] } },
      orderBy: { updatedAt: "desc" },
      take: CONTACTS_PER_COLUMN * 2,
      select: {
        id: true,
        name: true,
        status: true,
        company: { select: { name: true } },
        // Who set the meeting and when: the rep on the card.
        statusChanges: {
          where: { toStatus: "MEETING_SET" },
          orderBy: { on: "desc" },
          take: 1,
          select: { on: true, user: { select: { name: true } } },
        },
      },
    }),
    prisma.contact.groupBy({
      by: ["status"],
      where: { organizationId, status: { in: [...CONTACT_COLUMNS] } },
      _count: { _all: true },
    }),
    // Someone lost at the meeting stage has no deal to show; they sit in
    // Lost as a contact card.
    prisma.contact.findMany({
      where: { organizationId, status: "LOST", deals: { none: { stage: { in: ["QUOTE_SENT", "CONTRACT_SENT", "WON", "LOST", "ARCHIVED"] } } } },
      orderBy: { updatedAt: "desc" },
      take: CONTACTS_PER_COLUMN,
      select: { id: true, name: true, status: true, company: { select: { name: true } } },
    }),
    showArchived ? 0 : prisma.deal.count({ where: { organizationId, stage: "ARCHIVED" } }),
  ]);

  const openValue = deals.filter((deal) => isOpenStage(deal.stage)).reduce((sum, deal) => sum + dealValueCents(deal), 0);
  const inMeetings = meetingCounts.reduce((sum, row) => sum + row._count._all, 0);
  const empty = deals.length === 0 && meetingContacts.length === 0 && lostContacts.length === 0;

  return (
    <div>
      <PageHeader
        eyebrow="Closer's Club"
        title="Pipeline"
        subtitle={`${inMeetings.toLocaleString()} in meetings · ${formatCents(openValue)} in quotes and contracts out`}
        actions={
          <>
            <Link href={showArchived ? "/dashboard/deals" : "/dashboard/deals?archived=1"} className="btn btn-ghost btn-sm" data-testid="toggle-archived">
              {showArchived ? "Hide archived" : `Show archived${archivedCount ? ` (${archivedCount})` : ""}`}
            </Link>
            <Link href="/dashboard/deals/tracker" className="btn btn-ghost btn-sm">
              <IconClock size={13} />
              Contract Coordinator
            </Link>
            <Link href="/dashboard/quotes/new" className="btn btn-primary btn-sm">
              <IconPlus size={14} />
              New quote
            </Link>
          </>
        }
      />

      {empty ? (
        <Card lit>
          <EmptyState
            icon={<IconTrending size={20} />}
            title="Nothing on the pipeline yet"
            body="It starts at Meeting Set: book a meeting with a contact and they appear in the first column. Their quote going out moves them on."
            action={
              <Link href="/dashboard/contacts" className="btn btn-primary btn-sm">
                Go to contacts
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="-mx-5 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:px-8">
          <div className="grid min-w-[1320px] grid-cols-6 gap-3">
            {PIPELINE_COLUMNS.map((column) => {
              const isContactColumn = (CONTACT_COLUMNS as readonly string[]).includes(column);
              const contacts = isContactColumn
                ? meetingContacts.filter((contact) => contact.status === column).slice(0, CONTACTS_PER_COLUMN)
                : column === "LOST"
                  ? lostContacts.map((contact) => ({ ...contact, statusChanges: [] as (typeof meetingContacts)[number]["statusChanges"] }))
                  : [];
              const contactTotal = isContactColumn
                ? (meetingCounts.find((row) => row.status === column)?._count._all ?? 0)
                : contacts.length;
              const columnDeals = isContactColumn
                ? []
                : deals.filter((deal) => deal.stage === column || (showArchived && column === "CONTRACT_SENT" && deal.stage === "ARCHIVED"));
              const columnValue = columnDeals.reduce((sum, deal) => sum + dealValueCents(deal), 0);
              const accent = PIPELINE_COLUMN_COLORS[column as PipelineColumn];
              const count = contactTotal + columnDeals.length;
              return (
                <div key={column} className="card card-lit flex flex-col" data-testid={`pipeline-column-${column}`}>
                  <div className="border-b border-[var(--border)] px-3 py-3">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accent, boxShadow: `0 0 10px ${accent}` }} />
                      <h2 className="whitespace-nowrap text-sm font-semibold">{PIPELINE_COLUMN_LABELS[column as PipelineColumn]}</h2>
                      <span className="faint num text-xs">{count}</span>
                    </div>
                    <p className="num faint mt-1 pl-4 text-xs">
                      {isContactColumn ? (count === 1 ? "1 person" : `${count} people`) : formatCents(columnValue)}
                    </p>
                  </div>

                  <div className="flex-1 space-y-2 p-2.5">
                    {count === 0 && <p className="faint py-4 text-center text-xs">{isContactColumn ? "Nobody here" : "No deals"}</p>}

                    {contacts.map((contact) => {
                      const set = contact.statusChanges[0];
                      return (
                        <div
                          key={contact.id}
                          className="rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-3"
                          data-testid="pipeline-contact"
                        >
                          <Link href={`/dashboard/contacts/${contact.id}`} className="text-sm font-medium hover:underline">
                            {contact.name}
                          </Link>
                          {contact.company && <p className="faint text-xs">{contact.company.name}</p>}
                          <p className="mt-1.5 flex items-center gap-1 text-[0.7rem]">
                            <span className="faint">Rep:</span>
                            <span className="font-medium" data-testid="pipeline-contact-rep">{set?.user?.name ?? "Unassigned"}</span>
                          </p>
                          {set && (
                            <p className="faint mt-0.5 flex items-center gap-1 text-[0.7rem]">
                              <IconCalendar size={11} />
                              Meeting set {formatDate(set.on, timeZone)}
                            </p>
                          )}
                          <div className="mt-2">
                            <StatusPicker
                              kind="contact"
                              id={contact.id}
                              status={contact.status}
                              meetingSetOn={set ? dayInZone(set.on, timeZone) : null}
                              today={today}
                            />
                          </div>
                        </div>
                      );
                    })}
                    {isContactColumn && contactTotal > contacts.length && (
                      <p className="faint text-center text-[0.7rem]">and {contactTotal - contacts.length} more</p>
                    )}

                    {columnDeals.map((deal) => (
                      <div
                        key={deal.id}
                        className="rounded-lg border border-[var(--border)] bg-[rgb(255_255_255/0.02)] p-3"
                        data-testid="pipeline-deal"
                      >
                        <p className="text-sm font-medium">{deal.title}</p>
                        <div className="mb-1 mt-1.5 flex">
                          <OwnerSelect dealId={deal.id} ownerId={deal.ownerId} users={users} />
                        </div>
                        <Link href={`/dashboard/contacts/${deal.contact.id}`} className="link text-xs">
                          {deal.contact.company?.name ? `${deal.contact.company.name} · ${deal.contact.name}` : deal.contact.name}
                        </Link>
                        {deal.quotes.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {deal.quotes.map((quote) => (
                              <li key={quote.id}>
                                <Link
                                  href={`/dashboard/quotes/${quote.id}`}
                                  className="faint flex max-w-full items-center gap-1 text-[0.7rem] hover:text-[var(--text)]"
                                >
                                  <IconFileText size={11} className="shrink-0" />
                                  <span className="num shrink-0 whitespace-nowrap">QUO-{quote.number}</span>
                                  <span className="truncate">{quote.title}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                          <span className="num text-xs font-medium">{formatCents(dealValueCents(deal))}</span>
                          <StageSelect dealId={deal.id} stage={deal.stage} today={today} />
                        </div>
                        <Link
                          href={`/dashboard/deals/tracker?dealId=${deal.id}`}
                          className="faint mt-2 flex items-center gap-1 text-[0.7rem] hover:text-[var(--text)]"
                        >
                          <IconClock size={11} />
                          Contract Coordinator
                        </Link>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
