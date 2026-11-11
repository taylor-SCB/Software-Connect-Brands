import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents, formatDate } from "@/lib/format";
import {
  ACTIVITY_TYPES,
  CHANNEL_LABEL_NAMES,
  INDIVIDUAL_COMPANY_TYPE,
  NOTE_LABEL_NAMES,
  isConnect,
  isPersonalLabel,
  type ActivityTypeValue,
  type NoteLabelValue,
} from "@/lib/constants";
import { StarButton } from "@/components/star-button";
import { TagCell } from "../contacts-list";
import { setContactFavorite } from "../actions";
import { meetingSetDay } from "@/lib/status";
import { dayInZone } from "@/lib/calendar-auto";
import { UnlinkAccountButton } from "@/components/unlink-account-button";
import { dealValueCents, isOpenStage, QUOTES_FOR_VALUE } from "@/lib/deals";
import { batchOthers } from "@/lib/logging";
import { BackLink, StatusBadge, DealStageBadge } from "@/components/ui";
import { IconGlobe, IconPlus, IconBuilding, IconMessage, IconPhone } from "@/components/icons";
import { ActivityOverview } from "@/components/activity-overview";
import { UpcomingCard } from "@/components/upcoming-card";
import { loadEventChoices, upcomingFor } from "@/lib/calendar-data";
import { loadBalance } from "@/lib/money";
import { todayIso } from "@/lib/payments";
import { Avatar } from "@/components/avatar";
import { NotesList } from "@/components/notes-list";
import { AddNoteForm } from "./forms";
import { AddedBy } from "@/components/crm-cells";
import { RepPicker } from "@/components/rep-select";
import { loadRepChoices } from "@/lib/reps";
import { HealthRing } from "@/components/health-marks";
import { HealthWord } from "@/components/health-word";
import { contactHealth, healthSettings } from "@/lib/health-load";
import { nextKindOf, shortDay, stepOfStatus, time12, zoneDay, zoneTime } from "@/lib/health";
import { loadContactMeetings } from "./contact-data";
import { ContactShell } from "./contact-shell";
import { CallButton, MainAction, TextButton, type MainActionData, type PhoneRow } from "./action-bar";
import { MoreMenu } from "./more-menu";
import { HeaderMeter } from "./header-meter";
import { NextStepStrip, type NextItem } from "./next-step";
import { LogBar } from "./log-bar";
import { ContactHistory, type HistoryItem } from "./contact-history";
import { Collapsible, CopyButton, Disclosure } from "./bits";
import { PaperworkMenu } from "./paperwork-menu";
import { PhoneBar } from "./phone-bar";
import { ContactEmail } from "./contact-email";

const CHANNEL: Record<ActivityTypeValue, HistoryItem["channel"]> = {
  PHONE_CALL: "calls",
  TEXT: "texts",
  EMAIL: "emails",
  MEETING: "meetings",
};

// A contact's page (BDR redesign, Nov 11, 2026; Taylor approved the plan's
// "Contact page" section). It answers three questions in order: where
// this person stands (the header: avatar in its health ring, the meter,
// the reason sentence and one main button that follows the stage), what
// happened last time (Next step, "What happened with …?", the history by
// day) and what else there is (Reach, Coming up, Good to know, Paperwork).
// Nothing was taken away: New quote, New contract, Edit, Additional
// Account, the full status picker and Delete are under ⋯ More; the six
// Activity overview tiles are behind "Show counts"; the Details card is
// Reach with "More details"; Deals, Quotes, Contracts, Balance and Jobs
// are one Paperwork card with Add deal in its ⋯.
export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organizationId, userId, role } = await requireSession();
  const settings = await healthSettings(organizationId);
  const timeZone = settings.timeZone;

  const contact = await prisma.contact.findFirst({
    where: { id, organizationId },
    include: {
      company: { select: { id: true, name: true, industries: true, companyTypes: true } },
      createdBy: { select: { name: true } },
      accounts: {
        orderBy: { createdAt: "asc" },
        select: { company: { select: { id: true, name: true, city: true, state: true } } },
      },
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
      // "Opportunity Created" / "Deal Created" (Oct 27, 2026). Their tags
      // are read live: this person's role now, the deal's stage now.
      opportunityLogs: {
        orderBy: { occurredAt: "desc" },
        include: {
          user: { select: { name: true } },
          opportunity: {
            select: {
              title: true,
              deal: { select: { stage: true } },
              contacts: { where: { contactId: id }, select: { role: true } },
            },
          },
        },
      },
      quotes: {
        orderBy: { createdAt: "desc" },
        include: { deal: { select: { title: true } } },
      },
      contracts: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!contact) notFound();

  const now = new Date();
  const today = todayIso(timeZone);
  const [meetingSet, health, meetings, noteOthers, activityOthers, balance, projects, upcoming, eventChoices, reps] = await Promise.all([
    meetingSetDay(organizationId, { contactId: contact.id }),
    contactHealth(organizationId, contact.id, { settings, now }),
    loadContactMeetings(organizationId, contact.id, timeZone, now, { meetingSet: contact.status === "MEETING_SET" }),
    batchOthers("note", contact.notes.map((note) => note.batchId)),
    batchOthers("activity", contact.activities.map((activity) => activity.batchId)),
    // A homeowner's own balance. Someone at a company is billed through
    // the company, so this reads zero and the company's carries it.
    loadBalance(organizationId, { contactId: contact.id }, today),
    prisma.project.findMany({
      where: { organizationId, contactId: contact.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: { id: true, number: true, name: true, stage: true, awardedCents: true },
    }),
    // What is coming up with them, including days they are only an
    // attendee on — a property manager is often not the main contact.
    upcomingFor(organizationId, { contactId: contact.id }, today),
    loadEventChoices(organizationId, userId),
    loadRepChoices(organizationId),
  ]);
  if (!health) notFound();
  const meetingSetOn = meetingSet ? dayInZone(meetingSet, timeZone) : null;
  const canManage = role === "OWNER" || role === "ADMIN";

  // Marketing sends are on the log but never a touch (Nov 10, 2026).
  const touches = contact.activities.filter((a) => !a.marketing && a.outcome !== "NO_SHOW");
  const activityCounts = ACTIVITY_TYPES.reduce(
    (acc, type) => {
      acc[type] = touches.filter((a) => a.type === type).length;
      return acc;
    },
    {} as Record<ActivityTypeValue, number>,
  );
  const openDeals = contact.deals.filter((deal) => isOpenStage(deal.stage));
  const openDealValue = openDeals.reduce((sum, deal) => sum + dealValueCents(deal), 0);
  const quotesOut = contact.quotes.filter((quote) => quote.status === "SENT").length;
  const lastTouchAt = touches[0]?.occurredAt ?? null;
  const pickable = { id: contact.id, name: contact.name, company: contact.company?.name ?? null };
  const linkedIds = [...(contact.company ? [contact.company.id] : []), ...contact.accounts.map((row) => row.company.id)];

  // Numbers to call and text, the mobile first.
  const phoneLabel = contact.phone2 || contact.phoneLabel === "PERSONAL" ? `Phone · ${CHANNEL_LABEL_NAMES[contact.phoneLabel]}` : "Phone";
  const phones: PhoneRow[] = [
    ...(contact.mobile ? [{ label: "Mobile", number: contact.mobile, key: "mobile" as const }] : []),
    ...(contact.phone ? [{ label: phoneLabel, number: contact.phone, key: "phone" as const }] : []),
    ...(contact.phone2 ? [{ label: `Phone · ${CHANNEL_LABEL_NAMES[contact.phone2Label]}`, number: contact.phone2, key: "phone2" as const }] : []),
  ];

  // The main button's targets.
  const latest = <T extends { sentAt: Date | null; createdAt: Date }>(rows: T[]) =>
    [...rows].sort((a, b) => (b.sentAt ?? b.createdAt).getTime() - (a.sentAt ?? a.createdAt).getTime())[0] ?? null;
  const draftQuote = contact.quotes.find((quote) => quote.status === "DRAFT") ?? null;
  const sentQuote = latest(contact.quotes.filter((quote) => quote.status === "SENT"));
  const sentContract = latest(contact.contracts.filter((contract) => contract.status === "SENT" && !contract.payable));
  const signedContract = latest(contact.contracts.filter((contract) => contract.status === "SIGNED" && !contract.payable));
  const actionKey = health.meter.action?.key;
  const main: MainActionData = {
    action: health.meter.action,
    // Mark held answers the meeting waiting for it; with none (a status
    // set by hand) the button opens How did it go? on Meeting.
    meeting: actionKey === "mark-held" ? meetings.due : actionKey === "meeting" ? meetings.next : null,
    draftQuoteId: draftQuote?.id ?? null,
    sentQuoteId: sentQuote?.id ?? null,
    signingPath: sentContract ? `/c/${sentContract.publicToken}` : null,
    depositHref: signedContract ? `/dashboard/contracts/${signedContract.id}` : null,
  };

  // The first thing on Coming up, for the Next step strip.
  const firstEvent = upcoming[0] ?? null;
  const first: NextItem | null = firstEvent
    ? {
        eventId: firstEvent.id,
        title: firstEvent.title,
        when: whenWords(firstEvent.startOn, firstEvent.startTime, today),
        meeting: nextKindOf(firstEvent.type) === "meeting",
      }
    : null;

  // The history, newest first, with the paperwork's own dates beside the
  // touches (never counted as one): Quote sent, Accepted by <name>,
  // Contract sent and Signed are read from the quotes and contracts loaded
  // above, never written as Activity rows.
  const dayLabel = (day: string) => {
    if (day === today) return "Today";
    if (day === shiftIso(today, -1)) return "Yesterday";
    const words = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
      timeZone: "UTC",
    });
    return words.replace(",", "");
  };
  const clock = (at: Date) => time12(zoneTime(at, timeZone)) ?? "";
  const rows: { at: Date; item: HistoryItem }[] = [
    ...contact.activities.map((activity) => {
      const day = zoneDay(activity.occurredAt, timeZone);
      const others = activity.batchId ? (activityOthers.get(activity.batchId) ?? 0) : 0;
      return {
        at: activity.occurredAt,
        item: {
          id: activity.id,
          type: activity.type,
          body: activity.body,
          userName: activity.user.name,
          when: clock(activity.occurredAt),
          others,
          marketing: activity.marketing,
          outcome: activity.outcome,
          connect: activity.marketing ? undefined : isConnect(activity, now),
          undoBatchId: activity.batchId && !activity.marketing && (activity.userId === userId || canManage) ? activity.batchId : null,
          edit: !activity.marketing && (activity.userId === userId || canManage) ? { on: day, time: zoneTime(activity.occurredAt, timeZone), today } : null,
          day,
          dayLabel: dayLabel(day),
          channel: activity.marketing ? null : CHANNEL[activity.type as ActivityTypeValue],
        } satisfies HistoryItem,
      };
    }),
    ...contact.opportunityLogs
      .filter((log) => log.opportunity.contacts[0] && log.opportunity.contacts[0].role !== "HIDDEN")
      .map((log) => {
        const day = zoneDay(log.occurredAt, timeZone);
        return {
          at: log.occurredAt,
          item: {
            id: log.id,
            type: log.kind,
            body: log.opportunity.title,
            userName: log.user?.name ?? "",
            when: clock(log.occurredAt),
            others: 0,
            special: {
              role: log.opportunity.contacts[0].role as "PRIMARY" | "ASSOCIATED",
              stage: log.kind === "DEAL_CREATED" ? (log.opportunity.deal?.stage ?? null) : null,
            },
            day,
            dayLabel: dayLabel(day),
            channel: null,
          } satisfies HistoryItem,
        };
      }),
    ...contact.quotes
      .filter((quote) => quote.sentAt)
      .map((quote) => paperRow(quote.sentAt!, "QUOTE_SENT", quote.title, `/dashboard/quotes/${quote.id}`, `QUO-${quote.number}`)),
    // The customer said yes on their own copy (/q/<token>): "Accepted by
    // <the name they typed>", dated when they pressed it. Only while the
    // quote still reads Accepted (a decline from the office afterwards
    // re-dates respondedAt), and only an online yes: one marked by hand or
    // by signing a contract carries no name, and signing has its own line.
    ...contact.quotes
      .filter((quote) => quote.status === "ACCEPTED" && quote.respondedAt && quote.acceptedByName)
      .map((quote) =>
        paperRow(quote.respondedAt!, "QUOTE_ACCEPTED", quote.title, `/dashboard/quotes/${quote.id}`, `QUO-${quote.number}`, `Accepted by ${quote.acceptedByName}`),
      ),
    ...contact.contracts
      .filter((contract) => contract.sentAt)
      .map((contract) => paperRow(contract.sentAt!, "CONTRACT_SENT", contract.title, `/dashboard/contracts/${contract.id}`, `CON-${contract.number}`)),
    ...contact.contracts
      .filter((contract) => contract.signedAt)
      .map((contract) => paperRow(contract.signedAt!, "SIGNED", contract.title, `/dashboard/contracts/${contract.id}`, `CON-${contract.number}`)),
  ];
  function paperRow(at: Date, type: string, title: string, href: string, doc: string, label?: string): { at: Date; item: HistoryItem } {
    const day = zoneDay(at, timeZone);
    return {
      at,
      item: {
        id: `${type}-${doc}`,
        type,
        body: title,
        userName: "",
        when: clock(at),
        others: 0,
        paper: label ? { href, doc, label } : { href, doc },
        day,
        dayLabel: dayLabel(day),
        channel: null,
      },
    };
  }
  const history = rows.sort((a, b) => b.at.getTime() - a.at.getTime()).map((row) => row.item);

  // Good to know: the notes labelled Personal, Birthday, Hobbies or Family.
  const goodToKnow = contact.notes.filter((note) => isPersonalLabel(note.label)).slice(0, 3);

  // Paperwork appears once there is some, or from Meeting Completed on,
  // where Add deal lives.
  const owed = balance.owed.owedCents > 0;
  const step = stepOfStatus(contact.status);
  const canAddDeal = step >= 3 || contact.deals.length > 0;
  const hasPaperwork =
    contact.deals.length > 0 || contact.quotes.length > 0 || contact.contracts.length > 0 || projects.length > 0 || owed || canAddDeal;

  const moreProps = { contactId: contact.id, contactName: contact.name, linkedIds, status: contact.status, meetingSetOn, today, addDeal: !canAddDeal };

  return (
    <ContactShell
      contactId={contact.id}
      name={contact.name}
      companyId={contact.companyId}
      companyName={contact.company?.name ?? null}
      today={today}
      bookOpportunityId={meetings.missed?.opportunityId ?? null}
    >
      <div className="pb-20 sm:pb-0">
        <BackLink href="/dashboard/contacts" label="Contacts" current={contact.name} />

        <header className="card card-lit min-w-0 p-5 max-sm:p-4" data-testid="contact-header">
          <div className="flex items-start gap-4 max-sm:gap-3">
            <HealthRing health={health} className="shrink-0">
              <span className="max-sm:hidden">
                <Avatar url={contact.imageUrl} name={contact.name} size={56} round />
              </span>
              <span className="sm:hidden">
                <Avatar url={contact.imageUrl} name={contact.name} size={40} round />
              </span>
            </HealthRing>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-display font-semibold leading-tight tracking-tight max-sm:text-heading" data-testid="contact-name">
                  {contact.name}
                </h1>
                <StarButton id={contact.id} favorite={contact.favorite} action={setContactFavorite} label={contact.name} size={18} />
              </div>
              <p className="muted mt-0.5 text-sm" data-testid="contact-title-line">
                {contact.title}
                {contact.title && contact.company && " · "}
                {contact.company && (
                  <Link href={`/dashboard/companies/${contact.company.id}`} className="link">
                    {contact.company.name}
                  </Link>
                )}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <HealthWord health={health} />
                <label className="inline-flex items-center gap-1.5 text-xs" data-testid="contact-rep">
                  <span className="faint">Rep</span>
                  <RepPicker key={contact.ownerId ?? "none"} kind="contact" id={contact.id} ownerId={contact.ownerId} reps={reps} />
                </label>
                {contact.emailOptOutAt && (
                  <span className="badge text-[var(--warn)]" title={`Unsubscribed ${formatDate(contact.emailOptOutAt, timeZone)}`}>
                    Unsubscribed
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="contact-actions">
            <MainAction data={main} phones={phones} />
            <CallButton phones={phones} />
            <TextButton phones={phones} />
            <ContactEmail
              contact={{
                id: contact.id,
                name: contact.name,
                email: contact.email,
                email2: contact.email2,
                optedOutOn: contact.emailOptOutAt ? formatDate(contact.emailOptOutAt, timeZone) : null,
              }}
            />
            <MoreMenu {...moreProps} />
          </div>

          <HeaderMeter health={health} />
          <Disclosure label="Show counts" openLabel="Hide counts" testId="show-counts" className="mt-1">
            <ActivityOverview
              bare
              notes={contact.notes.length}
              personalNotes={contact.notes.filter((note) => isPersonalLabel(note.label)).length}
              activity={activityCounts}
              lastTouchAt={lastTouchAt}
              openDealCents={openDealValue}
              openDealCount={openDeals.length}
              quotesOut={quotesOut}
              timeZone={timeZone}
            />
          </Disclosure>
        </header>

        <div className="mt-5 flex flex-col gap-5 lg:grid lg:grid-cols-3 lg:items-start">
          <div className="contents lg:col-span-2 lg:flex lg:min-w-0 lg:flex-col lg:gap-5">
            <div className="order-1 min-w-0 lg:order-none">
              <NextStepStrip due={meetings.due} next={meetings.next} first={first} park={health.park} />
            </div>
            <div className="order-2 min-w-0 lg:order-none">
              <LogBar />
            </div>
            <section id="activity" className="card card-lit order-3 min-w-0 scroll-mt-20 lg:order-none">
              <div className="border-b border-[var(--hairline-3)] px-5 py-3.5">
                <h2 className="text-sm font-semibold">History</h2>
              </div>
              <ContactHistory items={history} />
            </section>
            <div className="order-9 min-w-0 lg:order-none">
              <Collapsible id="notes" title="Notes" subtitle={`${contact.notes.length} total`} testId="notes-card">
                <AddNoteForm target={{ contactId: contact.id }} current={pickable} />
                <div className="divider" />
                <NotesList
                  notes={contact.notes.map((note) => ({
                    id: note.id,
                    body: note.body,
                    label: note.label,
                    authorName: note.author.name,
                    when: formatDateTimeShort(note.createdAt, timeZone),
                    others: note.batchId ? (noteOthers.get(note.batchId) ?? 0) : 0,
                  }))}
                />
              </Collapsible>
            </div>
          </div>

          <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-5">
            <div className="order-4 min-w-0 lg:order-none">
              <Collapsible id="reach" title="Reach" testId="reach">
                <dl className="space-y-3 p-5 text-sm">
                  <ReachRow label="Mobile" number={contact.mobile} testId="contact-mobile" text />
                  <ReachRow label={phoneLabel} number={contact.phone} testId="contact-phone" text />
                  {contact.phone2 && (
                    <ReachRow label={`Phone · ${CHANNEL_LABEL_NAMES[contact.phone2Label]}`} number={contact.phone2} testId="contact-phone2" text />
                  )}
                  <Detail
                    label={contact.email2 || contact.emailLabel === "PERSONAL" ? `Email · ${CHANNEL_LABEL_NAMES[contact.emailLabel]}` : "Email"}
                    value={
                      contact.email ? (
                        <span className="inline-flex max-w-full items-center gap-1">
                          <a href={`mailto:${contact.email}`} className="link min-w-0 break-all" data-testid="contact-email">
                            {contact.email}
                          </a>
                          <CopyButton value={contact.email} label="email" />
                        </span>
                      ) : null
                    }
                  />
                  {contact.email2 && (
                    <Detail
                      label={`Email · ${CHANNEL_LABEL_NAMES[contact.email2Label]}`}
                      value={
                        <span className="inline-flex max-w-full items-center gap-1">
                          <a href={`mailto:${contact.email2}`} className="link min-w-0 break-all" data-testid="contact-email2">
                            {contact.email2}
                          </a>
                          <CopyButton value={contact.email2} label="email" />
                        </span>
                      }
                    />
                  )}
                  <Detail
                    label="Company"
                    value={
                      contact.company ? (
                        <Link href={`/dashboard/companies/${contact.company.id}`} className="link inline-flex items-center gap-1">
                          <IconBuilding size={12} />
                          {contact.company.name}
                        </Link>
                      ) : null
                    }
                  />
                  {contact.accounts.length > 0 && (
                    <Detail
                      label="Additional accounts"
                      value={
                        <ul className="space-y-1" data-testid="additional-accounts">
                          {contact.accounts.map(({ company }) => (
                            <li key={company.id} className="flex items-center justify-between gap-2">
                              <Link href={`/dashboard/companies/${company.id}`} className="link inline-flex min-w-0 items-center gap-1">
                                <IconBuilding size={12} className="shrink-0" />
                                <span className="truncate">{company.name}</span>
                                {(company.city || company.state) && (
                                  <span className="faint shrink-0 text-xs">· {[company.city, company.state].filter(Boolean).join(", ")}</span>
                                )}
                              </Link>
                              <UnlinkAccountButton contactId={contact.id} companyId={company.id} companyName={company.name} />
                            </li>
                          ))}
                        </ul>
                      }
                    />
                  )}
                </dl>
                <Disclosure label="More details" openLabel="Fewer details" testId="more-details" className="border-t border-[var(--hairline-3)] px-5 pb-3 pt-1">
                  <dl className="space-y-3 pt-2 text-sm" data-testid="more-details-list">
                    <Detail
                      label="Industry · Type"
                      value={
                        <TagCell
                          industries={contact.company?.industries ?? []}
                          types={contact.company ? contact.company.companyTypes : [INDIVIDUAL_COMPANY_TYPE]}
                        />
                      }
                    />
                    <Detail label="Title" value={contact.title} />
                    <Detail
                      label="Website"
                      value={
                        contact.website ? (
                          <a href={contact.website} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1">
                            <IconGlobe size={12} />
                            {contact.website.replace(/^https?:\/\//, "")}
                          </a>
                        ) : null
                      }
                    />
                    <Detail label="Birthday" value={contact.birthday ? formatDate(contact.birthday, "UTC") : null} />
                    <Detail label="Added" value={<AddedBy name={contact.createdBy?.name ?? null} at={contact.createdAt} timeZone={timeZone} />} />
                    <Detail label="City" value={contact.city} />
                    <Detail label="State" value={contact.state} />
                  </dl>
                </Disclosure>
              </Collapsible>
            </div>

            <div className="order-5 min-w-0 lg:order-none">
              <UpcomingCard
                events={upcoming}
                choices={eventChoices}
                phoneFold
                // What gets booked from a person's page is a meeting with them,
                // and only a Meeting sets Meeting Set, so the form starts on the
                // workspace's Meeting rather than the first type on its list
                // (Install).
                defaults={{
                  contactId: contact.id,
                  companyId: contact.companyId ?? undefined,
                  startOn: today,
                  type: eventChoices.eventTypes.find((name) => name.toLowerCase() === "meeting"),
                }}
                label={contact.name}
              />
            </div>

            {goodToKnow.length > 0 && (
              <div className="order-6 min-w-0 lg:order-none">
                <section className="card card-lit min-w-0" data-testid="good-to-know">
                  <div className="border-b border-[var(--hairline-3)] px-5 py-3.5">
                    <h2 className="text-sm font-semibold">Good to know</h2>
                  </div>
                  <ul className="space-y-2.5 px-5 py-4 text-sm">
                    {goodToKnow.map((note) => (
                      <li key={note.id} className="min-w-0">
                        <span className="faint mr-1.5 text-xs">{NOTE_LABEL_NAMES[note.label as NoteLabelValue]}</span>
                        <span className="break-words">{note.body}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-[var(--hairline-3)] px-5 py-2">
                    <a href="#notes" className="link text-xs">
                      All notes
                    </a>
                  </div>
                </section>
              </div>
            )}

            {hasPaperwork && (
              <div className="order-7 min-w-0 lg:order-none">
                <Collapsible
                  id="paperwork"
                  title="Paperwork"
                  subtitle={paperworkSummary(contact.deals.length, contact.quotes.length, contact.contracts.length, projects.length)}
                  testId="paperwork"
                  actions={<PaperworkMenu contactId={contact.id} canAddDeal={canAddDeal} />}
                >
                  <div className="divide-y divide-[var(--hairline-3)]">
                    {owed && (
                      <PaperSection title="Balance" testId="paperwork-balance">
                        <div className="flex items-baseline justify-between gap-3 px-5 pb-2">
                          <span className="muted text-sm">Owes you</span>
                          <span className={`num font-semibold ${balance.owed.overdueCount > 0 ? "text-[var(--danger)]" : ""}`} data-testid="balance-owed" data-cents={balance.owed.owedCents}>
                            {formatCents(balance.owed.owedCents)}
                          </span>
                        </div>
                        <ul>
                          {balance.rows.map((row) => (
                            <li key={`${row.contractId}-${row.label}-${row.dueOn ?? ""}`} className="flex items-baseline justify-between gap-3 px-5 py-1.5" data-testid="balance-row">
                              <Link href={`/dashboard/contracts/${row.contractId}`} className="link min-w-0 truncate text-sm">
                                {row.label} · <span className="docnum">CON-{row.contractNumber}</span>
                              </Link>
                              <span className={`num shrink-0 text-sm ${row.overdue ? "text-[var(--danger)]" : ""}`}>
                                {formatCents(row.amountCents - row.receivedCents)}
                                {row.dueOn ? ` · ${row.overdue ? "late since" : "due"} ${shortDay(row.dueOn)}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </PaperSection>
                    )}
                    {contact.deals.length > 0 && (
                      <PaperSection title="Deals" testId="paperwork-deals">
                        <ul>
                          {contact.deals.map((deal) => (
                            <li key={deal.id} className="flex items-center justify-between gap-3 px-5 py-2" data-testid="paperwork-deal">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{deal.title}</p>
                                <p className="faint num text-xs">
                                  {formatCents(dealValueCents(deal))} · {deal._count.quotes} {deal._count.quotes === 1 ? "quote" : "quotes"}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <DealStageBadge stage={deal.stage} />
                                <Link
                                  href={`/dashboard/quotes/new?contactId=${contact.id}&dealId=${deal.id}`}
                                  className="btn btn-ghost btn-sm pointer-coarse:min-h-11"
                                  title="New quote on this deal"
                                >
                                  <IconPlus size={12} />
                                  Quote
                                </Link>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </PaperSection>
                    )}
                    {contact.quotes.length > 0 && (
                      <PaperSection title="Quotes" testId="paperwork-quotes">
                        <ul>
                          {contact.quotes.map((quote) => (
                            <li key={quote.id}>
                              <Link href={`/dashboard/quotes/${quote.id}`} className="flex items-center justify-between gap-3 px-5 py-2 hover:bg-[var(--hover)]">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{quote.title}</p>
                                  <p className="faint text-xs">
                                    <span className="docnum">QUO-{quote.number}</span> · {quote.deal.title}
                                  </p>
                                </div>
                                <StatusBadge status={quote.status} />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </PaperSection>
                    )}
                    {contact.contracts.length > 0 && (
                      <PaperSection title="Contracts" testId="paperwork-contracts">
                        <ul>
                          {contact.contracts.map((contract) => (
                            <li key={contract.id}>
                              <Link href={`/dashboard/contracts/${contract.id}`} className="flex items-center justify-between gap-3 px-5 py-2 hover:bg-[var(--hover)]">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{contract.title}</p>
                                  <p className="faint text-xs">
                                    <span className="docnum">CON-{contract.number}</span>
                                  </p>
                                </div>
                                <StatusBadge status={contract.status} />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </PaperSection>
                    )}
                    {projects.length > 0 && (
                      <PaperSection title="Jobs" testId="paperwork-projects">
                        <ul>
                          {projects.map((project) => (
                            <li key={project.id}>
                              <Link href={`/dashboard/projects/${project.id}`} className="flex items-center justify-between gap-3 px-5 py-2 hover:bg-[var(--hover)]" data-testid="project-card-row">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{project.name}</p>
                                  <p className="faint num text-xs">
                                    <span className="docnum">PRJ-{project.number}</span> · {formatCents(project.awardedCents)}
                                  </p>
                                </div>
                                <StatusBadge status={project.stage} />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </PaperSection>
                    )}
                    {contact.deals.length === 0 && contact.quotes.length === 0 && contact.contracts.length === 0 && projects.length === 0 && !owed && (
                      <p className="faint px-5 py-4 text-sm" data-testid="paperwork-empty">
                        No paperwork yet. Start a quote, or add a deal from ⋯.
                      </p>
                    )}
                  </div>
                </Collapsible>
              </div>
            )}
          </div>
        </div>
      </div>

      <PhoneBar
        data={main}
        phones={phones}
        more={<MoreMenu {...moreProps} testId="phone-bar-more" label="⋯" buttonClassName="btn btn-ghost btn-sm min-h-11 w-full px-1 text-base" />}
      />
    </ContactShell>
  );
}

function paperworkSummary(deals: number, quotes: number, contracts: number, jobs: number) {
  const parts = [
    deals ? `${deals} ${deals === 1 ? "deal" : "deals"}` : null,
    quotes ? `${quotes} ${quotes === 1 ? "quote" : "quotes"}` : null,
    contracts ? `${contracts} ${contracts === 1 ? "contract" : "contracts"}` : null,
    jobs ? `${jobs} ${jobs === 1 ? "job" : "jobs"}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

function shiftIso(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// "Tue 10:00 AM", "Tomorrow", "Nov 19".
function whenWords(on: string, time: string | null, today: string) {
  const diff = Math.round((Date.parse(`${on}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  const day =
    diff <= 0
      ? "Today"
      : diff === 1
        ? "Tomorrow"
        : diff < 7
          ? new Date(`${on}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
          : shortDay(on);
  const clock = time12(time);
  return clock ? `${day} ${clock}` : day;
}

function formatDateTimeShort(at: Date, timeZone: string) {
  return `${shortDay(zoneDay(at, timeZone))} · ${time12(zoneTime(at, timeZone))}`;
}

function PaperSection({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <section className="py-2" data-testid={testId}>
      <h3 className="eyebrow px-5 pb-1 pt-1">{title}</h3>
      {children}
    </section>
  );
}

// A Reach row: the number, and Call / Text / Copy beside it.
function ReachRow({ label, number, testId, text }: { label: string; number: string | null; testId: string; text?: boolean }) {
  return (
    <Detail
      label={label}
      value={
        number ? (
          <span className="inline-flex flex-wrap items-center justify-end gap-1">
            <a href={`tel:${number}`} className="link num" data-testid={testId}>
              {number}
            </a>
            <a href={`tel:${number}`} className="btn btn-ghost btn-sm px-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11" aria-label={`Call ${number}`} title="Call">
              <IconPhone size={12} />
            </a>
            {text && (
              <a href={`sms:${number}`} className="btn btn-ghost btn-sm px-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11" aria-label={`Text ${number}`} title="Text">
                <IconMessage size={12} />
              </a>
            )}
            <CopyButton value={number} label="number" />
          </span>
        ) : null
      }
    />
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode | null | undefined }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="faint shrink-0 text-xs">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm">{value || <span className="faint">—</span>}</dd>
    </div>
  );
}
