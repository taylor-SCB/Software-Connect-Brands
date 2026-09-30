import { prisma } from "@/lib/prisma";
import {
  CONTRACT_ARCHIVE_DAYS,
  CONTRACT_LOST_DAYS,
  PIPELINE_STEPS,
  statusRank,
  type ContactStatusValue,
} from "@/lib/constants";

// The status ladder (Sept 30, 2026). A contact and a company each carry a
// status; every move is written to StatusChange with the day it happened,
// which is what Stats measures conversion and time-between-steps from.
//
// The app moves a status forward on its own for the events it can see —
// the first logged touch (Contacted), the first meeting booked (Meeting
// Set), a quote or contract going out, a contract signed — and never
// backwards. A company is as far along as the furthest of its people.
// Everything else (Interested, Not Interested, Meeting Completed, Lost) is
// set by a person, and skipping a pipeline step by hand asks for the day
// each skipped step happened.

type Who = { organizationId: string; userId?: string | null };

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

// Moves a contact forward to `target` if they are not already there or
// further, and their company with them. Returns whether it moved.
export async function advanceContact(
  who: Who,
  contactId: string,
  target: ContactStatusValue,
  options: { on?: Date; auto?: boolean; dealId?: string | null } = {},
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
  await prisma.$transaction([
    prisma.contact.updateMany({ where: { id: contactId, organizationId: who.organizationId }, data: { status: target } }),
    prisma.statusChange.create({
      data: {
        organizationId: who.organizationId,
        contactId,
        dealId: options.dealId ?? null,
        userId: who.userId ?? null,
        fromStatus: contact.status,
        toStatus: target,
        on,
        auto: options.auto ?? true,
      },
    }),
  ]);
  if (contact.companyId) await advanceCompany(who, contact.companyId, target, { on, auto: true });
  return true;
}

export async function advanceCompany(
  who: Who,
  companyId: string,
  target: ContactStatusValue,
  options: { on?: Date; auto?: boolean } = {},
): Promise<boolean> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: who.organizationId },
    select: { status: true },
  });
  if (!company) return false;
  // A company is not Lost because one of its people is.
  if (target === "LOST" || company.status === "ARCHIVED") return false;
  if (statusRank(target) <= statusRank(company.status)) return false;

  await prisma.$transaction([
    prisma.company.updateMany({ where: { id: companyId, organizationId: who.organizationId }, data: { status: target } }),
    prisma.statusChange.create({
      data: {
        organizationId: who.organizationId,
        companyId,
        userId: who.userId ?? null,
        fromStatus: company.status,
        toStatus: target,
        on: options.on ?? new Date(),
        auto: options.auto ?? true,
      },
    }),
  ]);
  return true;
}

// The first logged touch: Not Actioned becomes Contacted. Called for every
// contact an activity was logged on, and for a company logged directly.
export async function markContacted(who: Who, target: { contactIds: string[]; companyId?: string | null }, on: Date) {
  for (const contactId of target.contactIds) await advanceContact(who, contactId, "CONTACTED", { on });
  if (target.companyId) await advanceCompany(who, target.companyId, "CONTACTED", { on });
}

// A meeting booked with someone for the first time: Meeting Set. Only a
// contact, never a company on its own (Taylor, Sept 30, 2026); their
// company follows them.
export async function markMeetingSet(who: Who, contactIds: string[], on: Date) {
  for (const contactId of contactIds) await advanceContact(who, contactId, "MEETING_SET", { on });
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
