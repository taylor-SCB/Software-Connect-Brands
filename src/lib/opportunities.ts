import { prisma } from "@/lib/prisma";
import { advanceContact, type Who } from "@/lib/status";
import { statusRank, type ContactStatusValue, type PipelineColumn } from "@/lib/constants";
import { answerOf } from "@/lib/meeting-rule";
import type { Prisma } from "@/generated/prisma/client";

// Opportunities (Taylor, Oct 27, 2026): one tile on the Pipeline per sale
// being worked. See the model in prisma/schema.prisma for the shape; this
// file holds the rules, so the meeting forms, the paperwork and the board
// all apply the same ones. Not "use server": every function here takes an
// organizationId and must never be callable from a browser.

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
// them is already on an open opportunity (as Primary or Associated; Do
// Not List is not on it) the meeting joins it and anyone
// new from the meeting is added as Associated; otherwise it starts one,
// with the first person as Primary. Every meeting path calls this through
// markMeetingSet. `opportunity` lets the Book meeting sheet choose: "new"
// always starts one, an open opportunity's id joins that one (the
// company's open tile with someone else on it), anything else is the rule
// above. A meeting that already has its row (its calendar entry or history
// line, on any open tile) stays on that tile whatever is picked. The rep
// who booked it is kept on the meeting (bookedById, never edited) so a
// held meeting is credited to them (decision 13).
export async function attachMeeting(
  who: Who,
  contactIds: string[],
  meeting: { on: Date; activityId?: string | null; eventId?: string | null; opportunity?: string | null },
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

  // The meeting this already is — a calendar entry or history line that
  // already has its row, wherever that sits in the workspace — stays on its
  // own open tile (final audit, Nov 11, 2026). Only the tile picked below
  // used to be searched, so the calendar form or a claim naming a booked
  // entry without a tile wrote a second meeting on the person's newest tile
  // and left the booked one asking "how did it go?".
  const known =
    meeting.eventId || meeting.activityId
      ? await prisma.opportunityMeeting.findFirst({
          where: {
            ...(meeting.eventId ? { eventId: meeting.eventId } : { activityId: meeting.activityId }),
            opportunity: { organizationId, ...OPEN_OPPORTUNITY },
          },
          orderBy: { createdAt: "asc" },
          select: { id: true, opportunityId: true },
        })
      : null;
  const ownTile = known
    ? await prisma.opportunity.findFirst({
        where: { id: known.opportunityId, organizationId },
        select: { id: true, contacts: { select: { contactId: true } } },
      })
    : null;
  const pick = meeting.opportunity && meeting.opportunity !== "auto" && meeting.opportunity !== "new" ? meeting.opportunity : null;
  const chosen =
    ownTile ??
    (pick
      ? await prisma.opportunity.findFirst({
          where: { id: pick, organizationId, ...OPEN_OPPORTUNITY },
          select: { id: true, contacts: { select: { contactId: true } } },
        })
      : null);
  const existing =
    chosen ??
    (meeting.opportunity === "new"
      ? null
      : await prisma.opportunity.findFirst({
          // On it as Primary or Associated: Do Not List is not on it.
          where: {
            organizationId,
            ...OPEN_OPPORTUNITY,
            contacts: { some: { contactId: { in: ordered.map((person) => person.id) }, role: { not: "HIDDEN" } } },
          },
          orderBy: { updatedAt: "desc" },
          select: { id: true, contacts: { select: { contactId: true } } },
        }));

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
  const same =
    known && known.opportunityId === opportunityId
      ? known
      : meeting.eventId
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
      data: {
        opportunityId,
        on: meeting.on,
        activityId: meeting.activityId ?? null,
        eventId: meeting.eventId ?? null,
        bookedById: who.userId ?? null,
      },
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

  // Everyone listed moves forward with it (never back) — except that a
  // person's status follows their own meetings (final audit, Nov 11, 2026):
  // someone booked onto a tile already at Meeting Completed hasn't met yet,
  // so they stay at Meeting Set until that meeting is held (or its time has
  // passed). They used to jump straight to Meeting Completed on the booking.
  const target: ContactStatusValue | undefined = opportunity.deal
    ? (STATUS_FOR_STAGE[opportunity.deal.stage] ?? (opportunity.stage === "MEETING_COMPLETED" ? "MEETING_COMPLETED" : undefined))
    : opportunity.stage === "MEETING_COMPLETED"
      ? "MEETING_COMPLETED"
      : undefined;
  if (target) {
    const waiting = target === "MEETING_COMPLETED" ? await stillToMeet(organizationId, opportunity.id, listed) : new Set<string>();
    for (const contactId of listed) {
      if (waiting.has(contactId)) continue;
      await advanceContact(who, contactId, target, { dealId: opportunity.dealId, auto: true });
    }
  }
}

// The people on a tile whose own meeting on it is still to come with no
// answer, and who were in none of its held meetings: Meeting Completed
// waits for them. Only people not yet at Meeting Completed are looked at,
// so a tile everyone has caught up with costs one read. A meeting's people
// are its calendar entry's (who it is with and who is expected) and its
// history line's (one row per person in the save).
async function stillToMeet(organizationId: string, opportunityId: string, listed: string[]) {
  const waiting = new Set<string>();
  if (!listed.length) return waiting;
  const behind = (
    await prisma.contact.findMany({ where: { organizationId, id: { in: listed } }, select: { id: true, status: true } })
  ).filter((row) => statusRank(row.status) < statusRank("MEETING_COMPLETED"));
  if (!behind.length) return waiting;
  const meetings = await prisma.opportunityMeeting.findMany({
    where: { opportunityId, opportunity: { organizationId } },
    select: { on: true, outcome: true, activityId: true, eventId: true },
  });
  if (!meetings.length) return waiting;
  const eventIds = meetings.map((row) => row.eventId).filter((id): id is string => Boolean(id));
  const activityIds = meetings.map((row) => row.activityId).filter((id): id is string => Boolean(id));
  const [events, lines] = await Promise.all([
    eventIds.length
      ? prisma.calendarEvent.findMany({ where: { organizationId, id: { in: eventIds } }, select: { id: true, contactId: true, attendees: { select: { id: true } } } })
      : Promise.resolve([]),
    activityIds.length
      ? prisma.activity.findMany({ where: { organizationId, id: { in: activityIds } }, select: { id: true, outcome: true, batchId: true, contactId: true } })
      : Promise.resolve([]),
  ]);
  const batches = [...new Set(lines.map((row) => row.batchId).filter((id): id is string => Boolean(id)))];
  const siblings = batches.length
    ? await prisma.activity.findMany({ where: { organizationId, batchId: { in: batches } }, select: { batchId: true, contactId: true } })
    : [];
  const eventById = new Map(events.map((row) => [row.id, row]));
  const lineById = new Map(lines.map((row) => [row.id, row]));
  const now = Date.now();
  const held = new Set<string>();
  const ahead = new Set<string>();
  for (const meeting of meetings) {
    const event = meeting.eventId ? eventById.get(meeting.eventId) : undefined;
    const line = meeting.activityId ? lineById.get(meeting.activityId) : undefined;
    const people = new Set<string>();
    if (event) [event.contactId, ...event.attendees.map((row) => row.id)].forEach((id) => id && people.add(id));
    if (line?.contactId) people.add(line.contactId);
    if (line?.batchId) siblings.filter((row) => row.batchId === line.batchId && row.contactId).forEach((row) => people.add(row.contactId!));
    const answer = answerOf(meeting.outcome, line?.outcome);
    if (answer === "HELD") people.forEach((id) => held.add(id));
    else if (answer === null && meeting.on.getTime() > now) people.forEach((id) => ahead.add(id));
  }
  for (const row of behind) if (ahead.has(row.id) && !held.has(row.id)) waiting.add(row.id);
  return waiting;
}

// The board's own repair, run when it opens. Every deal gets an
// opportunity (deals from before Oct 27, 2026, and any made by a path
// that missed it), and everyone whose status puts them in the pipeline
// without an open opportunity gets one — a status moved by hand from a
// contact's page, or the people on the board before opportunities
// existed. People who were in the same meeting share one. Writes no log
// lines; those are written the next time the tile moves or is edited.
// Fixed ids make two tabs opening the board at once write each row once.
// Every row it writes is dated when the thing happened (the deal, the
// Meeting Set move, the meeting), never when the board was opened.
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
        // Dated by the meeting itself, not today (final audit, Nov 11,
        // 2026): a repair run now must never read as a booking made now.
        meetings.push({ id: `${id}-m-${meeting.id}`, opportunityId: id, on: meeting.occurredAt, activityId: meeting.id, createdAt: meeting.occurredAt });
      }
    }
    if (seen.size === 0 && setter) meetings.push({ id: `${id}-m-set`, opportunityId: id, on: setter.on, createdAt: setter.on });
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

// The one-tap reason a deal was lost (decision 14), written on that move's
// StatusChange rows: the deal's latest Lost and each of its people's.
export async function stampLostReason(organizationId: string, opportunityId: string, reason: string) {
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, organizationId },
    select: { dealId: true, deal: { select: { stage: true } }, contacts: { select: { contactId: true } } },
  });
  if (!opportunity) return { error: "That opportunity is no longer on the board" };
  if (!opportunity.dealId || opportunity.deal?.stage !== "LOST") return { error: "Move it to Lost first" };
  const latest = await prisma.statusChange.findFirst({
    where: { organizationId, dealId: opportunity.dealId, contactId: null, toStatus: "LOST" },
    orderBy: { on: "desc" },
    select: { id: true },
  });
  const people = await prisma.statusChange.findMany({
    where: { organizationId, dealId: opportunity.dealId, contactId: { in: opportunity.contacts.map((row) => row.contactId) }, toStatus: "LOST" },
    orderBy: { on: "desc" },
    distinct: ["contactId"],
    select: { id: true },
  });
  const ids = [latest?.id, ...people.map((row) => row.id)].filter((id): id is string => Boolean(id));
  if (!ids.length) return { error: "Move it to Lost first" };
  await prisma.statusChange.updateMany({ where: { organizationId, id: { in: ids } }, data: { reason } });
  return { success: "Reason saved" };
}

export { CLOSED_DEAL_STAGES, CONVERTED_STAGES };
