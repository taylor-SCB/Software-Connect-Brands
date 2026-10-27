import { prisma } from "@/lib/prisma";
import { advanceContact } from "@/lib/status";
import type { ContactStatusValue, PipelineColumn } from "@/lib/constants";
import type { Prisma } from "@/generated/prisma/client";

// Opportunities (Taylor, Oct 27, 2026): one tile on the Pipeline per sale
// being worked. See the model in prisma/schema.prisma for the shape; this
// file holds the rules, so the meeting forms, the paperwork and the board
// all apply the same ones. Not "use server": every function here takes an
// organizationId and must never be callable from a browser.

type Who = { organizationId: string; userId?: string | null };

// A deal at one of these has been "created" in Taylor's sense: the sale
// reached Quote Sent or further. Lead / Contacted is a quote not yet sent.
const CONVERTED_STAGES: readonly string[] = ["QUOTE_SENT", "CONTRACT_SENT", "WON", "LOST", "ARCHIVED"];
const CLOSED_DEAL_STAGES: readonly string[] = ["WON", "LOST"];

// What a deal's stage puts its people at.
const STATUS_FOR_STAGE: Record<string, ContactStatusValue | undefined> = {
  QUOTE_SENT: "QUOTE_SENT",
  CONTRACT_SENT: "CONTRACT_SENT",
  WON: "WON",
  LOST: "LOST",
};

// Open: Won or Lost closes it, and a new meeting after that starts a new
// one (Taylor, Oct 27, 2026). An Archived deal (a contract unanswered) is
// still open; it comes back if paperwork goes out again.
export const OPEN_OPPORTUNITY: Prisma.OpportunityWhereInput = {
  stage: { not: "LOST" },
  OR: [{ dealId: null }, { deal: { stage: { notIn: ["WON", "LOST"] } } }],
};

// The column a tile sits in. Only a deal is ever in Quote Sent or further
// (Taylor, Oct 27, 2026: the way there is converting it); a deal not sent
// yet (Lead) keeps the opportunity's own meeting column.
export function opportunityColumn(opportunity: { stage: string; deal: { stage: string } | null }): PipelineColumn | "ARCHIVED" {
  const deal = opportunity.deal;
  if (deal && CONVERTED_STAGES.includes(deal.stage)) return deal.stage as PipelineColumn | "ARCHIVED";
  return opportunity.stage as PipelineColumn;
}

function titleFor(contact: { name: string; company: { name: string } | null }) {
  return contact.company?.name ?? contact.name;
}

// A meeting logged, booked or ticked done with these people. If any of
// them is already on an open opportunity the meeting joins it and anyone
// new from the meeting is added as Associated; otherwise it starts one,
// with the first person as Primary. Every meeting path calls this through
// markMeetingSet.
export async function attachMeeting(
  who: Who,
  contactIds: string[],
  meeting: { on: Date; activityId?: string | null; eventId?: string | null },
) {
  const ids = Array.from(new Set(contactIds));
  if (ids.length === 0) return null;
  const { organizationId } = who;
  const people = await prisma.contact.findMany({
    where: { id: { in: ids }, organizationId },
    select: { id: true, name: true, company: { select: { name: true } } },
  });
  const ordered = ids.map((id) => people.find((person) => person.id === id)).filter((person) => person !== undefined);
  if (ordered.length === 0) return null;

  const existing = await prisma.opportunity.findFirst({
    where: { organizationId, ...OPEN_OPPORTUNITY, contacts: { some: { contactId: { in: ordered.map((person) => person.id) } } } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, contacts: { select: { contactId: true } } },
  });

  let opportunityId: string;
  if (existing) {
    opportunityId = existing.id;
    const on = new Set(existing.contacts.map((row) => row.contactId));
    const added = ordered.filter((person) => !on.has(person.id));
    if (added.length) {
      await prisma.opportunityContact.createMany({
        data: added.map((person) => ({ opportunityId, contactId: person.id, role: "ASSOCIATED" as const, fromMeeting: true })),
        skipDuplicates: true,
      });
    }
  } else {
    const created = await prisma.opportunity.create({
      data: {
        organizationId,
        title: titleFor(ordered[0]),
        ownerId: who.userId ?? null,
        contacts: {
          create: ordered.map((person, index) => ({
            contactId: person.id,
            role: index === 0 ? ("PRIMARY" as const) : ("ASSOCIATED" as const),
            fromMeeting: true,
          })),
        },
      },
      select: { id: true },
    });
    opportunityId = created.id;
  }

  // A booked meeting logged as done is the same meeting: its row takes
  // the activity and the day it happened rather than a second row.
  const same = meeting.eventId
    ? await prisma.opportunityMeeting.findFirst({ where: { opportunityId, eventId: meeting.eventId }, select: { id: true } })
    : meeting.activityId
      ? await prisma.opportunityMeeting.findFirst({ where: { opportunityId, activityId: meeting.activityId }, select: { id: true } })
      : null;
  if (same) {
    await prisma.opportunityMeeting.update({
      where: { id: same.id },
      data: { on: meeting.on, ...(meeting.activityId ? { activityId: meeting.activityId } : {}) },
    });
  } else {
    await prisma.opportunityMeeting.create({
      data: { opportunityId, on: meeting.on, activityId: meeting.activityId ?? null, eventId: meeting.eventId ?? null },
    });
  }
  await prisma.opportunity.updateMany({ where: { id: opportunityId, organizationId }, data: { updatedAt: new Date() } });
  await syncOpportunity(who, opportunityId);
  return opportunityId;
}

// There is no deal without an opportunity. A deal made anywhere (a quote
// or contract's deal box, "Add deal" on a contact) takes its contact's
// open opportunity that has no deal yet, or starts one with them as
// Primary.
export async function ensureOpportunityForDeal(who: Who, dealId: string) {
  const { organizationId } = who;
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
    select: { id: true, title: true, contactId: true, ownerId: true, opportunity: { select: { id: true } } },
  });
  if (!deal) return null;
  if (deal.opportunity) return deal.opportunity.id;

  const open = await prisma.opportunity.findFirst({
    where: {
      organizationId,
      dealId: null,
      stage: { not: "LOST" },
      contacts: { some: { contactId: deal.contactId, role: { in: ["PRIMARY", "ASSOCIATED"] } } },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  let opportunityId: string;
  if (open) {
    opportunityId = open.id;
    // updateMany with dealId: null so two deals made at once can't both
    // claim it; the loser starts its own.
    const claimed = await prisma.opportunity.updateMany({
      where: { id: open.id, organizationId, dealId: null },
      data: { dealId: deal.id },
    });
    if (claimed.count === 0) return ensureOpportunityForDeal(who, dealId);
  } else {
    const created = await prisma.opportunity.create({
      data: {
        organizationId,
        title: deal.title,
        stage: "MEETING_COMPLETED",
        ownerId: deal.ownerId ?? who.userId ?? null,
        dealId: deal.id,
        contacts: { create: [{ contactId: deal.contactId, role: "PRIMARY" }] },
      },
      select: { id: true },
    });
    opportunityId = created.id;
  }
  await syncOpportunity(who, opportunityId);
  return opportunityId;
}

// After a deal's stage moved, by hand or by paperwork.
export async function syncOpportunityForDeal(who: Who, dealId: string | null | undefined) {
  if (!dealId) return;
  const opportunityId = await ensureOpportunityForDeal(who, dealId);
  if (opportunityId) await syncOpportunity(who, opportunityId);
}

// Brings an opportunity's milestones, its people's log lines and their
// statuses in line with where it is. Safe to run any number of times:
// each person gets "Opportunity Created" once it reached Meeting
// Completed (or a deal) and "Deal Created" once its deal reached Quote
// Sent or further, exactly once each (a unique index), dated when the
// opportunity got there — so someone added later reads the same history.
// Do Not List takes a person's lines off; listing them again puts them
// back.
export async function syncOpportunity(who: Who, opportunityId: string) {
  const { organizationId } = who;
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, organizationId },
    select: {
      id: true,
      stage: true,
      completedAt: true,
      convertedAt: true,
      dealId: true,
      deal: { select: { stage: true, contactId: true } },
      contacts: { select: { contactId: true, role: true } },
    },
  });
  if (!opportunity) return;

  const now = new Date();
  const converted = opportunity.deal ? CONVERTED_STAGES.includes(opportunity.deal.stage) : false;
  const completedAt =
    opportunity.completedAt ?? (opportunity.stage === "MEETING_COMPLETED" || opportunity.deal ? now : null);
  const convertedAt = opportunity.convertedAt ?? (converted ? now : null);
  if (completedAt !== opportunity.completedAt || convertedAt !== opportunity.convertedAt) {
    await prisma.opportunity.updateMany({ where: { id: opportunity.id, organizationId }, data: { completedAt, convertedAt } });
  }

  const listed = opportunity.contacts.filter((row) => row.role !== "HIDDEN").map((row) => row.contactId);
  const hidden = opportunity.contacts.filter((row) => row.role === "HIDDEN").map((row) => row.contactId);
  const lines: Prisma.OpportunityLogCreateManyInput[] = [];
  for (const contactId of listed) {
    if (completedAt) {
      lines.push({ organizationId, opportunityId: opportunity.id, contactId, kind: "OPPORTUNITY_CREATED", userId: who.userId ?? null, occurredAt: completedAt });
    }
    if (convertedAt) {
      lines.push({ organizationId, opportunityId: opportunity.id, contactId, kind: "DEAL_CREATED", userId: who.userId ?? null, occurredAt: convertedAt });
    }
  }
  await prisma.$transaction([
    ...(lines.length ? [prisma.opportunityLog.createMany({ data: lines, skipDuplicates: true })] : []),
    ...(hidden.length ? [prisma.opportunityLog.deleteMany({ where: { opportunityId: opportunity.id, contactId: { in: hidden } } })] : []),
  ]);

  // The deal is filed under the Primary POC.
  const primary = opportunity.contacts.find((row) => row.role === "PRIMARY")?.contactId;
  if (opportunity.dealId && opportunity.deal && primary && opportunity.deal.contactId !== primary) {
    await prisma.deal.updateMany({ where: { id: opportunity.dealId, organizationId }, data: { contactId: primary } });
  }

  // Everyone listed moves forward with it (never back).
  const target: ContactStatusValue | undefined = opportunity.deal
    ? (STATUS_FOR_STAGE[opportunity.deal.stage] ?? (opportunity.stage === "MEETING_COMPLETED" ? "MEETING_COMPLETED" : undefined))
    : opportunity.stage === "MEETING_COMPLETED"
      ? "MEETING_COMPLETED"
      : undefined;
  if (target) {
    for (const contactId of listed) {
      await advanceContact(who, contactId, target, { dealId: opportunity.dealId, auto: true });
    }
  }
}

// The board's own repair, run when it opens. Every deal gets an
// opportunity (deals from before Oct 27, 2026, and any made by a path
// that missed it), and everyone whose status puts them in the pipeline
// without an open opportunity gets one — a status moved by hand from a
// contact's page, or the people on the board before opportunities
// existed. People who were in the same meeting share one. Writes no log
// lines; those are written the next time the tile moves or is edited.
// Fixed ids make two tabs opening the board at once write each row once.
export async function reconcileOpportunities(organizationId: string) {
  const orphanDeals = await prisma.deal.findMany({
    where: { organizationId, opportunity: null },
    select: {
      id: true,
      title: true,
      contactId: true,
      ownerId: true,
      stage: true,
      createdAt: true,
      stageChangedAt: true,
      contact: { select: { status: true } },
    },
    take: 2000,
  });
  if (orphanDeals.length) {
    await prisma.opportunity.createMany({
      data: orphanDeals.map((deal) => ({
        id: `opp-d-${deal.id}`,
        organizationId,
        title: deal.title,
        stage: deal.contact.status === "MEETING_SET" && !CONVERTED_STAGES.includes(deal.stage) ? ("MEETING_SET" as const) : ("MEETING_COMPLETED" as const),
        ownerId: deal.ownerId,
        dealId: deal.id,
        completedAt: deal.createdAt,
        convertedAt: CONVERTED_STAGES.includes(deal.stage) ? deal.stageChangedAt : null,
        createdAt: deal.createdAt,
      })),
      skipDuplicates: true,
    });
    await prisma.opportunityContact.createMany({
      data: orphanDeals.map((deal) => ({ opportunityId: `opp-d-${deal.id}`, contactId: deal.contactId, role: "PRIMARY" as const })),
      skipDuplicates: true,
    });
  }

  // In the pipeline by status, on no open opportunity. Lost only counts
  // for someone on no opportunity at all (the old board's Lost cards).
  const strays = await prisma.contact.findMany({
    where: {
      organizationId,
      OR: [
        {
          status: { in: ["MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT"] },
          opportunities: { none: { opportunity: OPEN_OPPORTUNITY } },
        },
        {
          status: "LOST",
          opportunities: { none: {} },
          // Someone lost on a deal is on that deal's opportunity already.
          deals: { none: {} },
          statusChanges: { some: { toStatus: "MEETING_SET" } },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      status: true,
      company: { select: { name: true } },
      statusChanges: { orderBy: { on: "desc" }, take: 1, select: { id: true } },
      activities: { where: { type: "MEETING" }, orderBy: { occurredAt: "desc" }, select: { id: true, batchId: true, occurredAt: true } },
    },
    take: 2000,
  });
  if (strays.length === 0) return;

  const setters = await prisma.statusChange.findMany({
    where: { organizationId, contactId: { in: strays.map((row) => row.id) }, toStatus: "MEETING_SET" },
    orderBy: { on: "desc" },
    select: { contactId: true, userId: true, on: true },
  });

  // People who were in the same latest meeting share a tile.
  const groups = new Map<string, typeof strays>();
  for (const person of strays) {
    const key = person.activities[0]?.batchId ?? `solo:${person.id}`;
    groups.set(key, [...(groups.get(key) ?? []), person]);
  }
  const rank = ["MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT"];
  const opportunities: Prisma.OpportunityCreateManyInput[] = [];
  const members: Prisma.OpportunityContactCreateManyInput[] = [];
  const meetings: Prisma.OpportunityMeetingCreateManyInput[] = [];
  for (const group of groups.values()) {
    const primary = group[0];
    const id = `opp-r-${primary.id}-${primary.statusChanges[0]?.id ?? "x"}`;
    const furthest = group.reduce((best, person) => (rank.indexOf(person.status) > rank.indexOf(best) ? person.status : best), group[0].status);
    const setter = setters.find((row) => row.contactId === primary.id);
    const lost = group.every((person) => person.status === "LOST");
    opportunities.push({
      id,
      organizationId,
      title: titleFor(primary),
      stage: lost ? "LOST" : furthest === "MEETING_SET" ? "MEETING_SET" : "MEETING_COMPLETED",
      ownerId: setter?.userId ?? null,
      completedAt: furthest === "MEETING_SET" || lost ? null : (setter?.on ?? new Date()),
      createdAt: setter?.on ?? new Date(),
    });
    group.forEach((person, index) => {
      members.push({ opportunityId: id, contactId: person.id, role: index === 0 ? "PRIMARY" : "ASSOCIATED", fromMeeting: true });
    });
    const seen = new Set<string>();
    for (const person of group) {
      for (const meeting of person.activities) {
        const key = meeting.batchId ?? meeting.id;
        if (seen.has(key)) continue;
        seen.add(key);
        meetings.push({ id: `${id}-m-${meeting.id}`, opportunityId: id, on: meeting.occurredAt, activityId: meeting.id });
      }
    }
    if (seen.size === 0 && setter) meetings.push({ id: `${id}-m-set`, opportunityId: id, on: setter.on });
  }
  await prisma.opportunity.createMany({ data: opportunities, skipDuplicates: true });
  await prisma.opportunityContact.createMany({ data: members, skipDuplicates: true });
  if (meetings.length) await prisma.opportunityMeeting.createMany({ data: meetings, skipDuplicates: true });
}

// A contact's status set by hand from their page. Their open opportunity
// where they are Primary follows as far as Meeting Completed; a deal stage
// picked there leaves the tile at Meeting Completed, since only
// converting it makes a deal (Taylor, Oct 27, 2026).
export async function followContactStatus(who: Who, contactId: string, status: string) {
  const opportunity = await prisma.opportunity.findFirst({
    where: { organizationId: who.organizationId, ...OPEN_OPPORTUNITY, contacts: { some: { contactId, role: "PRIMARY" } } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, dealId: true, stage: true },
  });
  if (!opportunity || opportunity.dealId) return;
  const stage =
    status === "MEETING_SET" || status === "MEETING_COMPLETED"
      ? status
      : status === "QUOTE_SENT" || status === "CONTRACT_SENT" || status === "WON"
        ? "MEETING_COMPLETED"
        : null;
  if (!stage || stage === opportunity.stage) return;
  await prisma.opportunity.updateMany({ where: { id: opportunity.id, organizationId: who.organizationId }, data: { stage } });
  await syncOpportunity(who, opportunity.id);
}

export { CLOSED_DEAL_STAGES, CONVERTED_STAGES };
