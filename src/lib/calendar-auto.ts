// The calendar entries the app writes on its own (Calendar v2, Sept 27,
// 2026): a call somebody logged, a quote going out and coming due, a
// contract going out and being signed. One place, so every screen that
// can send paperwork or log a touchpoint puts the same thing on the
// calendar, and so re-sending a quote moves its milestone instead of
// doubling it.
//
// Every row written here carries `auto: true` plus the quote, contract
// or activity it came from. That pair is what lets a milestone be found
// again and re-dated, and it is why nothing here ever touches an event
// somebody typed by hand — those have auto false and are never matched.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ensureEventType } from "@/lib/event-types";
import { DEFAULT_TIME_ZONE } from "@/lib/format";
import { addDays, isoToDate, todayIso } from "@/lib/payments";
import { ACTIVITY_EVENT_TYPE, FOLLOW_UP_DAYS, type ActivityTypeValue } from "@/lib/constants";

// The workspace's clock, read from its row rather than the session: the
// customer signing at /c/<token> has no session, and getTimeZone() would
// quietly fall back to the default zone and put a late-night signature
// on the wrong day.
async function zoneOf(organizationId: string) {
  return (await settingsOf(organizationId)).timeZone;
}

// The zone plus the follow-up rhythm (Settings → General): how many days
// after a quote or contract goes out each follow-up lands.
async function settingsOf(organizationId: string) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timeZone: true, quoteFollowUpDays: true, contractFollowUpDays: true },
  });
  return {
    timeZone: organization?.timeZone ?? DEFAULT_TIME_ZONE,
    quoteFollowUpDays: organization?.quoteFollowUpDays ?? [FOLLOW_UP_DAYS],
    contractFollowUpDays: organization?.contractFollowUpDays ?? [FOLLOW_UP_DAYS],
  };
}

// A moment as the yyyy-mm-dd the workspace's clock says it was. A quote
// sent at 11pm Central is a Tuesday on the calendar, not Wednesday UTC.
export function dayInZone(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// "HH:MM" in the workspace's clock for a moment, for the time beside a
// logged call.
export function timeInZone(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

// yyyy-mm-dd plus "HH:MM" in a zone → the instant. Same trick as
// zonedNoon in money.ts: guess UTC, read the zone's clock back, correct.
export function zonedMoment(isoDate: string, time: string, timeZone: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(guess);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess.getTime() - (local - guess.getTime()));
}

// Who a milestone belongs to when nobody is logged in to own it — the
// customer signing at /c/<token>, for one. The person who sent the
// paperwork, else the quote's lead rep, else the workspace's owner.
async function fallbackOwner(
  organizationId: string,
  source: { quoteId?: string | null; contractId?: string | null },
): Promise<string | null> {
  const sent = await prisma.calendarEvent.findFirst({
    where: {
      organizationId,
      auto: true,
      ownerId: { not: null },
      OR: [
        ...(source.contractId ? [{ contractId: source.contractId }] : []),
        ...(source.quoteId ? [{ quoteId: source.quoteId }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { ownerId: true },
  });
  if (sent?.ownerId) return sent.ownerId;

  if (source.quoteId) {
    const quote = await prisma.quote.findFirst({
      where: { id: source.quoteId, organizationId },
      select: { leadSalesRepId: true },
    });
    if (quote?.leadSalesRepId) return quote.leadSalesRepId;
  }

  const owner = await prisma.user.findFirst({
    where: { organizationId, role: "OWNER", removedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return owner?.id ?? null;
}

type MilestoneInput = {
  organizationId: string;
  type: string;
  title: string;
  startOn: string;
  ownerId: string | null;
  done: boolean;
  dealId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  projectId?: string | null;
  quoteId?: string | null;
  contractId?: string | null;
  notes?: string;
};

// Writes or re-dates one milestone. The match is the source plus the
// type: a quote has one "Quote sent" and one "Quote due", and sending it
// again moves them rather than adding a second of each.
async function putMilestone(input: MilestoneInput) {
  const type = (await ensureEventType(input.organizationId, input.type)) ?? input.type;
  const where = {
    organizationId: input.organizationId,
    auto: true,
    type,
    ...(input.quoteId ? { quoteId: input.quoteId } : {}),
    ...(input.contractId ? { contractId: input.contractId } : {}),
  };
  const existing = await prisma.calendarEvent.findFirst({ where, select: { id: true, doneAt: true } });
  const data = {
    title: input.title,
    type,
    startOn: isoToDate(input.startOn)!,
    endOn: null,
    notes: input.notes ?? "",
    dealId: input.dealId ?? null,
    companyId: input.companyId ?? null,
    contactId: input.contactId ?? null,
    projectId: input.projectId ?? null,
    quoteId: input.quoteId ?? null,
    contractId: input.contractId ?? null,
  };
  if (existing) {
    await prisma.calendarEvent.update({
      where: { id: existing.id },
      data: {
        ...data,
        // A milestone that already happened stays ticked; one moved back
        // into the future is open again.
        doneAt: input.done ? (existing.doneAt ?? new Date()) : null,
        ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      },
    });
    return existing.id;
  }
  const created = await prisma.calendarEvent.create({
    data: {
      organizationId: input.organizationId,
      auto: true,
      ownerId: input.ownerId,
      doneAt: input.done ? new Date() : null,
      ...data,
    },
    select: { id: true },
  });
  return created.id;
}

// Takes the app's open milestones of the given types off a quote or
// contract — the follow-up nobody needs once the customer has answered.
// A milestone already ticked done is history and stays.
async function dropOpenMilestones(
  organizationId: string,
  source: { quoteId?: string; contractId?: string },
  types: string[],
) {
  await prisma.calendarEvent.deleteMany({
    where: {
      organizationId,
      auto: true,
      doneAt: null,
      type: { in: types },
      ...(source.quoteId ? { quoteId: source.quoteId } : {}),
      ...(source.contractId ? { contractId: source.contractId } : {}),
    },
  });
}

// The follow-ups for one quote or contract, one per day in the rhythm.
// Open ones are rewritten from scratch each time (a re-send moves them);
// one already ticked done is history and stays, and a day it already
// covers is not written twice.
async function putFollowUps(input: {
  organizationId: string;
  type: "Quote follow up" | "Contract follow up";
  title: string;
  notes: string;
  sentOn: string;
  days: number[];
  today: string;
  ownerId: string | null;
  quoteId?: string;
  contractId?: string;
  who: { dealId?: string | null; contactId?: string | null; companyId?: string | null; projectId?: string | null };
}) {
  const source = input.quoteId ? { quoteId: input.quoteId } : { contractId: input.contractId };
  await dropOpenMilestones(input.organizationId, source, [input.type]);
  const kept = await prisma.calendarEvent.findMany({
    where: { organizationId: input.organizationId, auto: true, type: input.type, ...source },
    select: { startOn: true },
  });
  const covered = new Set(kept.map((row) => row.startOn.toISOString().slice(0, 10)));
  const days = [...new Set(input.days)].sort((a, b) => a - b);
  const type = (await ensureEventType(input.organizationId, input.type)) ?? input.type;
  for (const [index, day] of days.entries()) {
    const startOn = addDays(input.sentOn, day);
    if (covered.has(startOn)) continue;
    await prisma.calendarEvent.create({
      data: {
        organizationId: input.organizationId,
        auto: true,
        ownerId: input.ownerId,
        type,
        title: days.length > 1 ? `${input.title} (${index + 1} of ${days.length})` : input.title,
        notes: input.notes,
        startOn: isoToDate(startOn)!,
        doneAt: startOn < input.today ? new Date() : null,
        dealId: input.who.dealId ?? null,
        contactId: input.who.contactId ?? null,
        companyId: input.who.companyId ?? null,
        projectId: input.who.projectId ?? null,
        quoteId: input.quoteId ?? null,
        contractId: input.contractId ?? null,
      },
    });
  }
}

/* --------------------------------- Quotes --------------------------------- */

// Called whenever a quote's status or expiry changes. Sent: "Quote sent"
// on the day it went, a "Quote follow up" three days on, and "Quote due"
// on its valid-until day if it has one. Accepted or declined: the open
// follow-up and due go, since the answer has come. Back to draft: the
// same. The sent milestone itself is kept — it happened.
export async function syncQuoteEvents(organizationId: string, quoteId: string, actorId?: string | null) {
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, organizationId },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      sentAt: true,
      validUntil: true,
      dealId: true,
      contactId: true,
      leadSalesRepId: true,
      contact: { select: { name: true, companyId: true } },
    },
  });
  if (!quote) return;

  if (quote.status !== "SENT") {
    await dropOpenMilestones(organizationId, { quoteId: quote.id }, ["Quote follow up", "Quote due"]);
    return;
  }

  const { timeZone, quoteFollowUpDays } = await settingsOf(organizationId);
  const today = todayIso(timeZone);
  const sentOn = dayInZone(quote.sentAt ?? new Date(), timeZone);
  const ownerId = actorId ?? quote.leadSalesRepId ?? (await fallbackOwner(organizationId, { quoteId: quote.id }));
  const label = `QUO-${quote.number} ${quote.title}`;
  const who = { dealId: quote.dealId, contactId: quote.contactId, companyId: quote.contact.companyId };

  await putMilestone({
    organizationId,
    type: "Quote sent",
    title: `Quote sent · ${quote.contact.name}`,
    notes: label,
    startOn: sentOn,
    ownerId,
    done: true,
    quoteId: quote.id,
    ...who,
  });
  await putFollowUps({
    organizationId,
    type: "Quote follow up",
    title: `Follow up on quote · ${quote.contact.name}`,
    notes: label,
    sentOn,
    days: quoteFollowUpDays,
    today,
    ownerId,
    quoteId: quote.id,
    who,
  });
  if (quote.validUntil) {
    const dueOn = quote.validUntil.toISOString().slice(0, 10);
    await putMilestone({
      organizationId,
      type: "Quote due",
      title: `Quote due · ${quote.contact.name}`,
      notes: `${label} is valid until this day`,
      startOn: dueOn,
      ownerId,
      done: dueOn < today,
      quoteId: quote.id,
      ...who,
    });
  } else {
    await dropOpenMilestones(organizationId, { quoteId: quote.id }, ["Quote due"]);
  }
}

/* -------------------------------- Contracts -------------------------------- */

// Called whenever a contract's status changes. Sent: "Contract sent" and
// a "Contract follow up" three days on. Signed: "Contract closed" on the
// day it was signed, and the open follow-up goes. Declined or cancelled:
// the open follow-up goes. Reopened to draft: the same.
export async function syncContractEvents(organizationId: string, contractId: string, actorId?: string | null) {
  const contract = await prisma.contract.findFirst({
    where: { id: contractId, organizationId },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      payable: true,
      sentAt: true,
      signedAt: true,
      dealId: true,
      contactId: true,
      companyId: true,
      projectId: true,
      quoteId: true,
      contact: { select: { name: true } },
    },
  });
  if (!contract) return;

  const { timeZone, contractFollowUpDays } = await settingsOf(organizationId);
  const today = todayIso(timeZone);
  const label = `CON-${contract.number} ${contract.title}`;
  const who = {
    dealId: contract.dealId,
    contactId: contract.contactId,
    companyId: contract.companyId,
    projectId: contract.projectId,
  };

  if (contract.status === "SENT") {
    const sentOn = dayInZone(contract.sentAt ?? new Date(), timeZone);
    const ownerId =
      actorId ?? (await fallbackOwner(organizationId, { contractId: contract.id, quoteId: contract.quoteId }));
    await putMilestone({
      organizationId,
      type: "Contract sent",
      title: `${contract.payable ? "Purchase order" : "Contract"} sent · ${contract.contact.name}`,
      notes: label,
      startOn: sentOn,
      ownerId,
      done: true,
      contractId: contract.id,
      ...who,
    });
    await putFollowUps({
      organizationId,
      type: "Contract follow up",
      title: `Follow up on ${contract.payable ? "purchase order" : "contract"} · ${contract.contact.name}`,
      notes: label,
      sentOn,
      days: contractFollowUpDays,
      today,
      ownerId,
      contractId: contract.id,
      who,
    });
    return;
  }

  await dropOpenMilestones(organizationId, { contractId: contract.id }, ["Contract follow up"]);

  if (contract.status === "SIGNED") {
    const ownerId =
      actorId ?? (await fallbackOwner(organizationId, { contractId: contract.id, quoteId: contract.quoteId }));
    await putMilestone({
      organizationId,
      type: "Contract closed",
      title: `${contract.payable ? "Purchase order" : "Contract"} signed · ${contract.contact.name}`,
      notes: label,
      startOn: dayInZone(contract.signedAt ?? new Date(), timeZone),
      ownerId,
      done: true,
      contractId: contract.id,
      ...who,
    });
  }
}

/* ------------------------------- Touchpoints ------------------------------- */

// A call, email, text or meeting logged from a contact's or company's
// page lands on the calendar too — on the day it happened, ticked done,
// under whoever logged it. Logged on several contacts at once, it is one
// event with the first contact as who it was with and the rest expected.
export async function recordActivityEvent(input: {
  organizationId: string;
  userId: string;
  activityId: string;
  type: ActivityTypeValue;
  body: string;
  occurredAt: Date;
  withTime: boolean;
  contactIds: string[];
  companyId: string | null;
  primaryName: string;
}) {
  const timeZone = await zoneOf(input.organizationId);
  const type = (await ensureEventType(input.organizationId, ACTIVITY_EVENT_TYPE[input.type])) ?? ACTIVITY_EVENT_TYPE[input.type];
  const [first, ...rest] = input.contactIds;
  const created = await prisma.calendarEvent.create({
    data: {
      organizationId: input.organizationId,
      auto: true,
      activityId: input.activityId,
      ownerId: input.userId,
      type,
      title: `${type} · ${input.primaryName}`,
      startOn: isoToDate(dayInZone(input.occurredAt, timeZone))!,
      startTime: input.withTime ? timeInZone(input.occurredAt, timeZone) : null,
      notes: input.body,
      contactId: first ?? null,
      companyId: input.companyId,
      doneAt: input.occurredAt,
      attendees: { connect: rest.map((id) => ({ id })) },
    },
    select: { id: true },
  });
  return created.id;
}

// A call booked for later from the same form: on the calendar, open,
// under whoever booked it, and not in anyone's activity history yet —
// it has not happened.
export async function scheduleActivityEvent(input: {
  organizationId: string;
  userId: string;
  type: ActivityTypeValue;
  body: string;
  startOn: string;
  startTime: string | null;
  contactIds: string[];
  companyId: string | null;
  primaryName: string;
}) {
  const type = (await ensureEventType(input.organizationId, ACTIVITY_EVENT_TYPE[input.type])) ?? ACTIVITY_EVENT_TYPE[input.type];
  const [first, ...rest] = input.contactIds;
  const created = await prisma.calendarEvent.create({
    data: {
      organizationId: input.organizationId,
      ownerId: input.userId,
      type,
      title: `${type} · ${input.primaryName}`,
      startOn: isoToDate(input.startOn)!,
      startTime: input.startTime,
      notes: input.body,
      contactId: first ?? null,
      companyId: input.companyId,
      attendees: { connect: rest.map((id) => ({ id })) },
    },
    select: { id: true },
  });
  return created.id;
}

/* ---------------------------- Marketing sends ---------------------------- */

// One entry per marketing send, not one per recipient: forty emails in a
// morning is one thing that happened, and each contact already has its
// own line in their Activity.
export async function recordMarketingSendEvent(input: {
  organizationId: string;
  userId: string;
  subject: string;
  sent: number;
  attachmentNames: string[];
  // The one recipient, when there was only one, so the entry is with them.
  contact: { id: string; companyId: string | null } | null;
}) {
  const timeZone = await zoneOf(input.organizationId);
  const type = (await ensureEventType(input.organizationId, "Email")) ?? "Email";
  const now = new Date();
  await prisma.calendarEvent.create({
    data: {
      organizationId: input.organizationId,
      auto: true,
      ownerId: input.userId,
      type,
      title: `Email · ${input.subject}`,
      notes: `Marketing email to ${input.sent} ${input.sent === 1 ? "contact" : "contacts"}${
        input.attachmentNames.length ? ` with ${input.attachmentNames.join(", ")}` : ""
      }`,
      startOn: isoToDate(dayInZone(now, timeZone))!,
      startTime: timeInZone(now, timeZone),
      doneAt: now,
      contactId: input.contact?.id ?? null,
      companyId: input.contact?.companyId ?? null,
    },
  });
}

/* ------------------------------ Ticking done ------------------------------ */

// The activity type a calendar type reads back as when its day is ticked
// done and logged: a Call is a call; a quote follow-up was most likely a
// call too, and the box lets the person say otherwise.
export function activityTypeFor(eventType: string): ActivityTypeValue {
  const match = (Object.keys(ACTIVITY_EVENT_TYPE) as ActivityTypeValue[]).find(
    (key) => ACTIVITY_EVENT_TYPE[key].toLowerCase() === eventType.toLowerCase(),
  );
  return match ?? "PHONE_CALL";
}

// Whether ticking this entry done can write a line in somebody's
// history: it is with a contact or a company, and it has not been logged
// already (a call logged from the form arrives on the calendar with its
// history line attached).
export function canLogOnDone(event: { contactId: string | null; companyId: string | null; activityId?: string | null }) {
  return Boolean(event.contactId || event.companyId) && !event.activityId;
}

// Ticking a scheduled call done and saying how it went: the Activity
// lines are written (one per contact — the one it was with plus anyone
// expected — sharing a batch), the first is linked to the entry, and the
// entry is done as of the day and time it was for.
export async function logEventDone(input: {
  organizationId: string;
  userId: string;
  eventId: string;
  activityType: ActivityTypeValue;
  note: string;
}) {
  const event = await prisma.calendarEvent.findFirst({
    where: { id: input.eventId, organizationId: input.organizationId },
    select: {
      id: true,
      title: true,
      notes: true,
      startOn: true,
      startTime: true,
      contactId: true,
      companyId: true,
      activityId: true,
      projectId: true,
      attendees: { select: { id: true } },
    },
  });
  if (!event) return { error: "That day is no longer on the calendar" };
  if (!canLogOnDone(event)) return { error: "This entry is not with anyone, so there is nobody to log it on" };

  const timeZone = await zoneOf(input.organizationId);
  const day = event.startOn.toISOString().slice(0, 10);
  const today = todayIso(timeZone);
  // When it happened: the time it was booked for, else now if it was
  // today, else midday on its day.
  const occurredAt = event.startTime
    ? zonedMoment(day, event.startTime, timeZone)
    : day === today
      ? new Date()
      : zonedMoment(day, "12:00", timeZone);
  const body = input.note.trim() || event.notes.trim() || event.title;

  const contactIds = [...new Set([event.contactId, ...event.attendees.map((row) => row.id)].filter((id): id is string => Boolean(id)))];
  const rows = contactIds.length
    ? contactIds.map((contactId) => ({ contactId, companyId: null as string | null }))
    : [{ contactId: null as string | null, companyId: event.companyId }];
  const batchId = rows.length > 1 ? randomUUID() : null;

  const written = await prisma.$transaction(
    rows.map((row) =>
      prisma.activity.create({
        data: {
          organizationId: input.organizationId,
          contactId: row.contactId,
          companyId: row.companyId,
          projectId: event.projectId,
          userId: input.userId,
          type: input.activityType,
          body,
          batchId,
          occurredAt,
        },
        select: { id: true },
      }),
    ),
  );
  await prisma.calendarEvent.update({
    where: { id: event.id },
    data: { doneAt: occurredAt > new Date() ? new Date() : occurredAt, activityId: written[0].id },
  });
  return { ok: true as const, contactIds, companyId: event.companyId };
}

// Unticking an entry that was logged from the calendar takes that
// history line back out. The link is cleared first: the Activity row
// cascades to the entry, so deleting it first would delete the entry.
export async function unlogEventDone(organizationId: string, eventId: string) {
  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, organizationId },
    select: { id: true, auto: true, activityId: true, activity: { select: { batchId: true } } },
  });
  if (!event) return;
  // A call logged from the form is history first and a calendar entry
  // second; unticking it is not how that line gets deleted.
  if (!event.activityId || event.auto) return;
  const batchId = event.activity?.batchId ?? null;
  const activityId = event.activityId;
  await prisma.calendarEvent.update({ where: { id: event.id }, data: { activityId: null } });
  await prisma.activity.deleteMany({
    where: { organizationId, ...(batchId ? { batchId } : { id: activityId }) },
  });
}
