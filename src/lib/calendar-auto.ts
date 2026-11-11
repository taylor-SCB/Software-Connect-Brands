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

import { prisma } from "@/lib/prisma";
import { ensureEventType } from "@/lib/event-types";
import { DEFAULT_TIME_ZONE } from "@/lib/format";
import { addDays, isoToDate, todayIso } from "@/lib/payments";
import {
  ACTIVITY_EVENT_TYPE,
  ACTIVITY_LABELS,
  CONNECT_OUTCOMES,
  FOLLOW_UP_DAYS,
  OUTCOMES_BY_TYPE,
  PARK_DAYS,
  type ActivityOutcomeValue,
  type ActivityTypeValue,
  type StatusReasonValue,
} from "@/lib/constants";
import { cleanTime, isRealDay } from "@/lib/calendar";
import { formatDay } from "@/lib/format";
import { markByHand, markConnected, markContacted, markMeetingSet } from "@/lib/status";
import { outcomeNote, type LogMark, type NextStep } from "@/lib/outcomes";
import { newBatchId } from "@/lib/undo-log";

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
  batchId?: string | null;
}) {
  const timeZone = await zoneOf(input.organizationId);
  const type = (await ensureEventType(input.organizationId, ACTIVITY_EVENT_TYPE[input.type])) ?? ACTIVITY_EVENT_TYPE[input.type];
  const [first, ...rest] = input.contactIds;
  const created = await prisma.calendarEvent.create({
    data: {
      organizationId: input.organizationId,
      auto: true,
      batchId: input.batchId ?? null,
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
  batchId?: string | null;
}) {
  const type = (await ensureEventType(input.organizationId, ACTIVITY_EVENT_TYPE[input.type])) ?? ACTIVITY_EVENT_TYPE[input.type];
  const [first, ...rest] = input.contactIds;
  const created = await prisma.calendarEvent.create({
    data: {
      organizationId: input.organizationId,
      batchId: input.batchId ?? null,
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

// The follow-ups picked from the "Want to set a follow-up?" box after a
// call, text, email or meeting is logged (Oct 4, 2026): one open entry
// per thing ticked, each on its own day, with the same people as the
// touch it follows and under whoever logged it. Typed by a person, so
// `auto` is false like any other scheduled call: nothing here is ever
// re-dated or swept by the app.
export async function scheduleFollowUpEvents(input: {
  organizationId: string;
  userId: string;
  // `title` names a reminder that isn't a plain follow-up ("Try to book
  // a meeting · Dana", "Try again · Dana").
  items: { type: ActivityTypeValue; startOn: string; startTime: string | null; title?: string }[];
  contactIds: string[];
  companyId: string | null;
  primaryName: string;
  // What it follows up on, for the entry's notes: "Follow up on the call
  // logged Oct 4: left a voicemail…".
  about: string;
  batchId?: string | null;
}) {
  const [first, ...rest] = input.contactIds;
  const ids: string[] = [];
  for (const item of input.items) {
    const type = (await ensureEventType(input.organizationId, ACTIVITY_EVENT_TYPE[item.type])) ?? ACTIVITY_EVENT_TYPE[item.type];
    const created = await prisma.calendarEvent.create({
      data: {
        organizationId: input.organizationId,
        ownerId: input.userId,
        batchId: input.batchId ?? null,
        type,
        title: item.title ?? `Follow up · ${input.primaryName}`,
        startOn: isoToDate(item.startOn)!,
        startTime: item.startTime,
        notes: input.about,
        contactId: first ?? null,
        companyId: input.companyId,
        attendees: { connect: rest.map((id) => ({ id })) },
      },
      select: { id: true },
    });
    ids.push(created.id);
  }
  return ids;
}

/* -------------------------------- Next step -------------------------------- */

// The next step picked in "How did it go?", checked before anything is
// written so a bad day refuses the whole save. Follow-ups, "Try to book a
// meeting" and "Try again in 30 days" are calendar entries like the
// follow-up box writes; a meeting is booked by the caller.
export type PlannedNextStep =
  | { kind: "follow" | "book" | "park"; type: ActivityTypeValue; startOn: string; startTime: string | null }
  | { kind: "meeting"; on: string; time: string | null; withContactIds: string[]; where: string | null; note: string | null; opportunity: string | null };

export function planNextStep(next: NextStep | undefined, today: string): PlannedNextStep | { error: string } | null {
  if (!next) return null;
  const time = cleanTime(next.time);
  const on = next.on || "";
  if (on && !isRealDay(on)) return { error: "That day isn't a real date" };
  if (next.kind === "park") return { kind: "park", type: "PHONE_CALL", startOn: addDays(today, PARK_DAYS), startTime: null };
  if (next.kind === "book") {
    const day = on || addDays(today, FOLLOW_UP_DAYS);
    if (day < today) return { error: "Pick today or a day ahead for the reminder" };
    return { kind: "book", type: "PHONE_CALL", startOn: day, startTime: time };
  }
  if (!on) return { error: next.kind === "meeting" ? "Pick the day of the meeting" : "Pick the day for the follow-up" };
  if (on < today) {
    return { error: next.kind === "meeting" ? "Pick today or a day ahead for the meeting" : `A follow-up has to be today or later (it's dated ${formatDay(`${on}T12:00:00Z`)})` };
  }
  if (next.kind === "meeting") {
    return {
      kind: "meeting",
      on,
      time,
      withContactIds: next.withContactIds,
      where: next.where?.trim() || null,
      note: next.note?.trim() || null,
      opportunity: next.opportunity?.trim() || null,
    };
  }
  return { kind: "follow", type: next.type ?? "PHONE_CALL", startOn: on, startTime: time };
}

// Writes a planned follow-up / reminder / park, tagged with the save.
export async function writeNextStep(input: {
  organizationId: string;
  userId: string;
  batchId: string;
  plan: Extract<PlannedNextStep, { kind: "follow" | "book" | "park" }>;
  contactIds: string[];
  companyId: string | null;
  primaryName: string;
  about: string;
}) {
  const title =
    input.plan.kind === "book"
      ? `Try to book a meeting · ${input.primaryName}`
      : input.plan.kind === "park"
        ? `Try again · ${input.primaryName}`
        : undefined;
  const [eventId] = await scheduleFollowUpEvents({
    organizationId: input.organizationId,
    userId: input.userId,
    items: [{ type: input.plan.type, startOn: input.plan.startOn, startTime: input.plan.startTime, title }],
    contactIds: input.contactIds,
    companyId: input.companyId,
    primaryName: input.primaryName,
    about: input.about,
    batchId: input.batchId,
  });
  const day = formatDay(`${input.plan.startOn}T12:00:00Z`);
  const words =
    input.plan.kind === "book"
      ? `“Try to book a meeting” on the calendar for ${day}`
      : input.plan.kind === "park"
        ? `Parked: “Try again” on the calendar for ${day}`
        : `${ACTIVITY_LABELS[input.plan.type]} follow-up on the calendar for ${day}`;
  return { eventId, words };
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
//
// "How did it go?" (Nov 11, 2026) adds the outcome, an Interested / Not
// interested mark with its reason, and the next step, so the chain of
// follow-ups never ends here. A meeting ticked done that has happened is
// Held (decision 4): HELD on the line, Connected, and the tile and its
// people at Meeting Completed; one whose day is still ahead is handed back
// as { confirmEarly } unless `early` says it happened early. A no-show is
// written NO_SHOW (not a touch) and keeps Meeting Set. Any other outcome
// on an entry dated later today or ahead means it happened now. Every row
// the save writes carries its batchId, for undoLog.
export async function logEventDone(input: {
  organizationId: string;
  userId: string;
  eventId: string;
  activityType: ActivityTypeValue;
  note: string;
  outcome?: ActivityOutcomeValue | null;
  mark?: LogMark | null;
  reason?: StatusReasonValue | null;
  next?: NextStep;
  early?: boolean;
}): Promise<
  | { ok: true; contactIds: string[]; companyId: string | null; batchId: string; notices: string[]; opportunityId: string | null }
  | { error: string; confirmEarly?: string }
> {
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
  const now = new Date();
  // When it happened: the time it was booked for, else now if it was
  // today, else midday on its day.
  let occurredAt = event.startTime
    ? zonedMoment(day, event.startTime, timeZone)
    : day === today
      ? new Date()
      : zonedMoment(day, "12:00", timeZone);

  const meeting = input.activityType === "MEETING";
  let outcome: ActivityOutcomeValue | null = input.outcome ?? null;
  if (outcome && !OUTCOMES_BY_TYPE[input.activityType].includes(outcome)) {
    return { error: "That outcome doesn't fit that kind of touch" };
  }
  if (meeting && outcome === "HELD" && day > today && !input.early) {
    return { error: `This meeting is ${formatDay(`${day}T12:00:00Z`)}. Did it happen early?`, confirmEarly: day };
  }
  // A meeting ticked done that has happened was held.
  if (meeting && !outcome && occurredAt <= now) outcome = "HELD";
  // Saying how it went means it happened: an entry for later is now.
  if (outcome && occurredAt > now) occurredAt = now;
  const plan = planNextStep(input.next, today);
  if (plan && "error" in plan) return { error: plan.error };

  const said = Boolean(input.outcome || input.mark);
  const body =
    input.note.trim() ||
    (said ? outcomeNote({ outcome: input.outcome, mark: input.mark, reason: input.reason }) : "") ||
    event.notes.trim() ||
    event.title;

  const contactIds = [...new Set([event.contactId, ...event.attendees.map((row) => row.id)].filter((id): id is string => Boolean(id)))];
  const rows = contactIds.length
    ? contactIds.map((contactId) => ({ contactId, companyId: null as string | null }))
    : [{ contactId: null as string | null, companyId: event.companyId }];
  const batchId = newBatchId();

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
          outcome,
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
    data: { doneAt: occurredAt > now ? now : occurredAt, activityId: written[0].id },
  });
  const who = { organizationId: input.organizationId, userId: input.userId, batchId };
  const companyOnly = contactIds.length ? null : event.companyId;
  const notices: string[] = [];
  let opportunityId: string | null = null;

  if (outcome !== "NO_SHOW") await markContacted(who, { contactIds, companyId: companyOnly }, occurredAt);
  if (outcome && CONNECT_OUTCOMES.includes(outcome) && occurredAt <= now) {
    await markConnected(who, { contactIds, companyId: companyOnly }, occurredAt);
  }
  const { meetingFor, recordMeetingHeld, recordMeetingNoShow, bookMeetingCore } = await import("@/lib/meetings");
  if (meeting && outcome !== "NO_SHOW") {
    opportunityId = await markMeetingSet(who, contactIds, occurredAt, { activityId: written[0].id, eventId: event.id });
    if (outcome === "HELD" && occurredAt <= now) {
      const meetingId = await meetingFor(input.organizationId, opportunityId, written[0].id);
      if (meetingId) await recordMeetingHeld(who, meetingId, { early: true });
    }
  }
  if (meeting && outcome === "NO_SHOW") {
    const row = await prisma.opportunityMeeting.findFirst({
      where: { eventId: event.id, opportunity: { organizationId: input.organizationId } },
      select: { id: true, opportunityId: true },
    });
    if (row) {
      await prisma.opportunityMeeting.update({ where: { id: row.id }, data: { activityId: written[0].id } });
      await recordMeetingNoShow(who, row.id);
      opportunityId = row.opportunityId;
    }
  }
  if (input.mark) await markByHand(who, { contactIds, companyId: companyOnly }, input.mark, occurredAt, input.reason ?? null);

  if (plan && plan.kind === "meeting") {
    const booked = await bookMeetingCore(who, {
      contactIds: [...new Set([...contactIds, ...plan.withContactIds])],
      companyId: event.companyId,
      on: plan.on,
      time: plan.time,
      where: plan.where,
      note: plan.note,
      opportunity: plan.opportunity,
    });
    if ("error" in booked) notices.push(booked.error ?? "The meeting couldn't be booked");
    else {
      notices.push(booked.message);
      opportunityId = booked.opportunityId ?? opportunityId;
    }
  } else if (plan) {
    const primary = contactIds.length
      ? await prisma.contact.findFirst({ where: { id: contactIds[0], organizationId: input.organizationId }, select: { name: true } })
      : event.companyId
        ? await prisma.company.findFirst({ where: { id: event.companyId, organizationId: input.organizationId }, select: { name: true } })
        : null;
    const step = await writeNextStep({
      organizationId: input.organizationId,
      userId: input.userId,
      batchId,
      plan,
      contactIds,
      companyId: event.companyId,
      primaryName: primary?.name ?? "",
      about: `Follow up on the ${ACTIVITY_LABELS[input.activityType].toLowerCase()} logged ${formatDay(`${dayInZone(occurredAt, timeZone)}T12:00:00Z`)}: ${body}`,
    });
    notices.push(step.words);
  }
  return { ok: true as const, contactIds, companyId: event.companyId, batchId, notices, opportunityId };
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
