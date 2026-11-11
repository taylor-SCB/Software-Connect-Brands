import { prisma } from "@/lib/prisma";
import {
  CONTRACT_ARCHIVE_DAYS,
  CONTRACT_LOST_DAYS,
  PASS_THROUGH_CONNECTED,
  PIPELINE_STEPS,
  statusRank,
  type ContactStatusValue,
} from "@/lib/constants";

// The status ladder (Sept 30, 2026). A contact and a company each carry a
// status; every move is written to StatusChange with the day it happened,
// which is what Stats measures conversion and time-between-steps from.
//
// The app moves a status forward on its own for the events it can see —
// the first logged touch (Contacted, shown "Attempted"), a talk, reply or
// held meeting (Connected), the first meeting booked (Meeting Set), a
// meeting held (Meeting Completed), a quote or contract going out, a
// contract signed — and never backwards. A company is as far along as
// the furthest of its people.
// Everything else (Interested, Not Interested, Lost) is set by a person,
// and skipping a pipeline step by hand asks for the day each skipped step
// happened.

// `batchId` ties every StatusChange a save writes to that save, so
// "Undo" (undoLog) can take exactly those back.
export type Who = { organizationId: string; userId?: string | null; batchId?: string | null };

// The statuses a contact's paperwork puts them at.
const DEAL_TO_STATUS: Record<string, ContactStatusValue | undefined> = {
  QUOTE_SENT: "QUOTE_SENT",
  CONTRACT_SENT: "CONTRACT_SENT",
  WON: "WON",
  LOST: "LOST",
};

export function statusForDealStage(stage: string) {
  return DEAL_TO_STATUS[stage];
}

// The steps a forward move writes, in order: Interested, Not Interested
// and Meeting Set from below Connected go through Connected first, the
// same day (Nov 11, 2026), because nobody hears interest or books a
// meeting without talking. Nothing else is passed through.
export function stepsTo(current: string, target: ContactStatusValue): ContactStatusValue[] {
  const below = current === "NOT_ACTIONED" || current === "CONTACTED";
  return below && PASS_THROUGH_CONNECTED.includes(target) ? ["CONNECTED", target] : [target];
}

// Moves a contact forward to `target` if they are not already there or
// further, and their company with them. Returns whether it moved.
export async function advanceContact(
  who: Who,
  contactId: string,
  target: ContactStatusValue,
  options: { on?: Date; auto?: boolean; dealId?: string | null; reason?: string | null } = {},
): Promise<boolean> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId: who.organizationId },
    select: { status: true, companyId: true },
  });
  if (!contact) return false;
  // From Lost the only way back is a new meeting or new paperwork (Lost
  // ranks below everything, so any forward move lifts it).
  // Lost comes from a deal lost or the contract clock, and only takes
  // someone who was in the pipeline and not already won.
  const moves =
    target === "LOST"
      ? statusRank(contact.status) >= statusRank("MEETING_SET") && contact.status !== "WON"
      : statusRank(target) > statusRank(contact.status) && contact.status !== "ARCHIVED";
  if (!moves) return false;

  const on = options.on ?? new Date();
  const steps = target === "LOST" ? [target] : stepsTo(contact.status, target);
  let from: string = contact.status;
  const rows = steps.map((step) => {
    const row = prisma.statusChange.create({
      data: {
        organizationId: who.organizationId,
        contactId,
        dealId: options.dealId ?? null,
        userId: who.userId ?? null,
        fromStatus: from,
        toStatus: step,
        on,
        auto: options.auto ?? true,
        batchId: who.batchId ?? null,
        reason: step === target ? (options.reason ?? null) : null,
      },
    });
    from = step;
    return row;
  });
  await prisma.$transaction([
    prisma.contact.updateMany({ where: { id: contactId, organizationId: who.organizationId }, data: { status: target } }),
    ...rows,
  ]);
  if (contact.companyId) await advanceCompany(who, contact.companyId, target, { on, auto: true });
  return true;
}

export async function advanceCompany(
  who: Who,
  companyId: string,
  target: ContactStatusValue,
  options: { on?: Date; auto?: boolean; reason?: string | null } = {},
): Promise<boolean> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: who.organizationId },
    select: { status: true },
  });
  if (!company) return false;
  // A company is not Lost because one of its people is.
  if (target === "LOST" || company.status === "ARCHIVED") return false;
  if (statusRank(target) <= statusRank(company.status)) return false;

  const on = options.on ?? new Date();
  let from: string = company.status;
  const rows = stepsTo(company.status, target).map((step) => {
    const row = prisma.statusChange.create({
      data: {
        organizationId: who.organizationId,
        companyId,
        userId: who.userId ?? null,
        fromStatus: from,
        toStatus: step,
        on,
        auto: options.auto ?? true,
        batchId: who.batchId ?? null,
        reason: step === target ? (options.reason ?? null) : null,
      },
    });
    from = step;
    return row;
  });
  await prisma.$transaction([
    prisma.company.updateMany({ where: { id: companyId, organizationId: who.organizationId }, data: { status: target } }),
    ...rows,
  ]);
  return true;
}

// The first logged touch: Not Actioned becomes Contacted (shown as
// "Attempted"). Called for every contact an activity was logged on, and
// for a company logged directly.
export async function markContacted(who: Who, target: { contactIds: string[]; companyId?: string | null }, on: Date) {
  for (const contactId of target.contactIds) await advanceContact(who, contactId, "CONTACTED", { on });
  if (target.companyId) await advanceCompany(who, target.companyId, "CONTACTED", { on });
}

// A connect — a live talk, a reply, a held meeting (Nov 11, 2026): Not
// Actioned or Attempted becomes Connected, forward only, and the company
// follows like it does for every automatic move. A company logged
// directly (nobody linked) connects on its own.
export async function markConnected(who: Who, target: { contactIds: string[]; companyId?: string | null }, on: Date) {
  for (const contactId of target.contactIds) await advanceContact(who, contactId, "CONNECTED", { on });
  if (target.companyId) await advanceCompany(who, target.companyId, "CONNECTED", { on });
}

// Interested or Not Interested picked in "How did it go?" (Nov 11, 2026):
// set by a person, in the same save as the touch, with the reason they
// gave (decision 14). Only for someone still before the pipeline (Not
// Actioned, Attempted, Connected, Interested, Not Interested); a person
// at Meeting Set or further is moved from the Pipeline, and Lost or
// Archived from their page. From Not Actioned or Attempted it passes
// through Connected. The company follows forward, as always.
export async function markByHand(
  who: Who,
  target: { contactIds: string[]; companyId?: string | null },
  mark: "INTERESTED" | "NOT_INTERESTED",
  on: Date,
  reason: string | null = null,
) {
  const before = ["NOT_ACTIONED", "CONTACTED", "CONNECTED", "INTERESTED", "NOT_INTERESTED"];
  const moved: string[] = [];
  const records = [
    ...target.contactIds.map((id) => ({ kind: "contact" as const, id })),
    ...(target.companyId && !target.contactIds.length ? [{ kind: "company" as const, id: target.companyId }] : []),
  ];
  for (const record of records) {
    const row =
      record.kind === "contact"
        ? await prisma.contact.findFirst({ where: { id: record.id, organizationId: who.organizationId }, select: { status: true, companyId: true } })
        : await prisma.company.findFirst({ where: { id: record.id, organizationId: who.organizationId }, select: { status: true } });
    if (!row || !before.includes(row.status) || row.status === mark) continue;
    let from: string = row.status;
    const steps = stepsTo(row.status, mark);
    const scope = record.kind === "contact" ? { contactId: record.id } : { companyId: record.id };
    const writes = steps.map((step) => {
      const write = prisma.statusChange.create({
        data: {
          organizationId: who.organizationId,
          ...scope,
          userId: who.userId ?? null,
          fromStatus: from,
          toStatus: step,
          on,
          auto: step !== mark,
          batchId: who.batchId ?? null,
          reason: step === mark ? reason : null,
        },
      });
      from = step;
      return write;
    });
    await prisma.$transaction([
      record.kind === "contact"
        ? prisma.contact.updateMany({ where: { id: record.id, organizationId: who.organizationId }, data: { status: mark } })
        : prisma.company.updateMany({ where: { id: record.id, organizationId: who.organizationId }, data: { status: mark } }),
      ...writes,
    ]);
    moved.push(record.id);
    const companyId = "companyId" in row && typeof row.companyId === "string" ? row.companyId : null;
    if (companyId) await advanceCompany(who, companyId, mark, { on, auto: true, reason });
  }
  return moved;
}

// A meeting booked with someone for the first time: Meeting Set. Only a
// contact, never a company on its own (Taylor, Sept 30, 2026); their
// company follows them. Since Oct 27, 2026 every meeting also lands on an
// opportunity (attachMeeting): `meeting` is the meeting's own day and the
// activity or calendar entry it is, where `on` is when it was set.
// `opportunity` picks which tile a booking joins ("auto": an open one any
// of these people is on; "new": always a new one; or an open one's id).
export async function markMeetingSet(
  who: Who,
  contactIds: string[],
  on: Date,
  meeting: { on?: Date; activityId?: string | null; eventId?: string | null; opportunity?: string | null } = {},
) {
  for (const contactId of contactIds) await advanceContact(who, contactId, "MEETING_SET", { on });
  // Imported when called: opportunities.ts builds on this file.
  const { attachMeeting } = await import("@/lib/opportunities");
  return attachMeeting(who, contactIds, {
    on: meeting.on ?? on,
    activityId: meeting.activityId,
    eventId: meeting.eventId,
    opportunity: meeting.opportunity,
  });
}

export type SkippedDates = Partial<Record<(typeof PIPELINE_STEPS)[number], string>>;

// The pipeline steps between where a record is and where it is going that
// it has never been through: each needs a date when set by hand.
export function skippedSteps(current: string, target: string): (typeof PIPELINE_STEPS)[number][] {
  const from = PIPELINE_STEPS.indexOf(current as (typeof PIPELINE_STEPS)[number]);
  const to = PIPELINE_STEPS.indexOf(target as (typeof PIPELINE_STEPS)[number]);
  if (to <= 0) return [];
  // From before the pipeline, everything up to the target counts as
  // skipped, Meeting Set included.
  const start = from === -1 ? 0 : from + 1;
  return PIPELINE_STEPS.slice(start, to) as (typeof PIPELINE_STEPS)[number][];
}

// Deals whose contract has gone unanswered: Archived at 90 days, Lost at
// 180, both counted from the day the contract went out. Run whenever the
// Pipeline, Contacts or Stats is opened — the app's own clock, no outside
// scheduler — and cheap when there is nothing to do.
export async function sweepStaleContracts(organizationId: string) {
  const now = Date.now();
  const archiveBefore = new Date(now - CONTRACT_ARCHIVE_DAYS * 86_400_000);
  const loseBefore = new Date(now - CONTRACT_LOST_DAYS * 86_400_000);

  // Archiving keeps stageChangedAt as the day the contract went out, so
  // the 180 days run from there.
  const toArchive = await prisma.deal.findMany({
    where: { organizationId, stage: "CONTRACT_SENT", stageChangedAt: { lt: archiveBefore } },
    select: { id: true, stageChangedAt: true },
    take: 500,
  });
  for (const deal of toArchive) {
    await prisma.$transaction([
      prisma.deal.updateMany({ where: { id: deal.id, organizationId, stage: "CONTRACT_SENT" }, data: { stage: "ARCHIVED" } }),
      prisma.statusChange.create({
        data: {
          organizationId,
          dealId: deal.id,
          fromStatus: "CONTRACT_SENT",
          toStatus: "ARCHIVED",
          on: new Date(deal.stageChangedAt.getTime() + CONTRACT_ARCHIVE_DAYS * 86_400_000),
          auto: true,
        },
      }),
    ]);
  }

  const toLose = await prisma.deal.findMany({
    where: { organizationId, stage: "ARCHIVED", stageChangedAt: { lt: loseBefore } },
    select: { id: true, contactId: true, stageChangedAt: true },
    take: 500,
  });
  for (const deal of toLose) {
    const on = new Date(deal.stageChangedAt.getTime() + CONTRACT_LOST_DAYS * 86_400_000);
    await prisma.$transaction([
      prisma.deal.updateMany({ where: { id: deal.id, organizationId, stage: "ARCHIVED" }, data: { stage: "LOST", stageChangedAt: on } }),
      prisma.statusChange.create({
        data: { organizationId, dealId: deal.id, fromStatus: "ARCHIVED", toStatus: "LOST", on, auto: true },
      }),
    ]);
    await advanceContact({ organizationId }, deal.contactId, "LOST", { on, dealId: deal.id });
  }
  if (toLose.length) {
    const { syncOpportunityForDeal } = await import("@/lib/opportunities");
    for (const deal of toLose) await syncOpportunityForDeal({ organizationId }, deal.id);
  }
}

// Not in a "use server" file on purpose: it takes an organizationId and
// must never be callable from a browser.
// The day a contact's (or company's) meeting was set, for prefilling the
// dates of the steps skipped after it.
export async function meetingSetDay(organizationId: string, scope: { contactId?: string; companyId?: string }) {
  const row = await prisma.statusChange.findFirst({
    where: { organizationId, ...scope, toStatus: "MEETING_SET" },
    orderBy: { on: "desc" },
    select: { on: true },
  });
  return row?.on ?? null;
}
