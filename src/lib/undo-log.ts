import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

// "Saved · Undo" (BDR redesign, Nov 11, 2026): one save taken back, in one
// transaction. A save is everything that carries its batchId — the
// Activity rows (one per person), the calendar copy, the follow-up,
// reminder or meeting booked in the same save, and the StatusChange rows
// it wrote — plus what those rows hang off. Nothing else is touched.
//
// - Statuses go back to where the save found them, but only while they
//   are still where the save left them (someone who moved a person since
//   keeps their move); the save's StatusChange rows go.
// - A calendar entry the save ticked done (the Done box, Held) is
//   unticked and kept; one the save wrote is deleted.
// - A meeting row the save made is deleted, and its opportunity too when
//   the save made it and nothing else is on it; a meeting row that was
//   there before goes back to no outcome. An opportunity the save moved
//   to Meeting Completed goes back to Meeting Set, without its
//   "Opportunity Created" lines; people the save's meeting added to an
//   opportunity that stays come off it.
// - The touch and connect dates on people and companies are recomputed by
//   the database triggers when the Activity rows go.
// - A meeting action (Held / No-show from the Pipeline) is a save whose
//   batchId is "m:<meetingId>:<uuid>": its meeting's outcome, and the
//   outcome it set on a history line written before, are cleared too.
//
// Not "use server": takes an organizationId. Marketing sends can't be
// undone here (they went out).

// A save's batchId: when it started (this server's clock, base 36) and a
// uuid. The start is what tells "moved to Meeting Completed by this save"
// apart from "already there", since that moment (Opportunity.completedAt)
// is stamped by the same clock.
export function newBatchId() {
  return `${Date.now().toString(36)}.${randomUUID()}`;
}

export function meetingBatchId(meetingId: string) {
  return `m:${meetingId}:${newBatchId()}`;
}

function startedAt(batchId: string): Date | null {
  const stamp = batchId.split(":").pop()?.split(".")[0] ?? "";
  const ms = /^[0-9a-z]{6,10}$/.test(stamp) ? parseInt(stamp, 36) : NaN;
  // Anything outside 2026–2100 isn't one of ours.
  return Number.isFinite(ms) && ms > 1_767_225_600_000 && ms < 4_102_444_800_000 ? new Date(ms) : null;
}

export type UndoResult =
  | { ok: true; contactIds: string[]; companyIds: string[]; opportunityIds: string[]; removed: number }
  | { error: string };

export async function undoLogCore(
  organizationId: string,
  batchId: string,
  actor: { userId: string; canManage: boolean },
): Promise<UndoResult> {
  const meetingId = batchId.startsWith("m:") ? batchId.split(":")[1] || null : null;
  const [activities, events, changes, meetingRow] = await Promise.all([
    prisma.activity.findMany({
      where: { organizationId, batchId },
      select: { id: true, userId: true, contactId: true, companyId: true, marketing: true, createdAt: true },
    }),
    prisma.calendarEvent.findMany({ where: { organizationId, batchId }, select: { id: true, ownerId: true, createdAt: true } }),
    prisma.statusChange.findMany({
      where: { organizationId, batchId },
      select: { id: true, contactId: true, companyId: true, fromStatus: true, toStatus: true, userId: true, createdAt: true },
    }),
    meetingId
      ? prisma.opportunityMeeting.findFirst({
          where: { id: meetingId, opportunity: { organizationId } },
          select: { id: true, opportunityId: true, activityId: true, outcome: true },
        })
      : Promise.resolve(null),
  ]);
  const meetingSet = Boolean(meetingRow?.outcome);
  if (!activities.length && !events.length && !changes.length && !meetingSet) {
    return { error: "That has already been undone" };
  }
  if (activities.some((row) => row.marketing)) return { error: "A marketing email can't be undone. It went out." };
  const owner = activities[0]?.userId ?? events[0]?.ownerId ?? changes[0]?.userId ?? null;
  if (!actor.canManage && owner && owner !== actor.userId) {
    return { error: "Only whoever logged it, or an Owner or Admin, can undo it" };
  }

  const stamps = [...activities, ...events, ...changes].map((row) => row.createdAt.getTime());
  const savedAt = stamps.length ? new Date(Math.min(...stamps)) : null;
  // When the save began, by the clock that stamps completedAt.
  const began = startedAt(batchId) ?? savedAt;
  const activityIds = activities.map((row) => row.id);
  const eventIds = events.map((row) => row.id);

  const meetings = await prisma.opportunityMeeting.findMany({
    where: {
      opportunity: { organizationId },
      OR: [
        ...(activityIds.length ? [{ activityId: { in: activityIds } }] : []),
        ...(eventIds.length ? [{ eventId: { in: eventIds } }] : []),
        ...(meetingRow ? [{ id: meetingRow.id }] : []),
      ],
    },
    select: { id: true, opportunityId: true, activityId: true, eventId: true, createdAt: true },
  });
  // Made by this save: booked with an entry it wrote, or written after it
  // started for a line it wrote.
  const madeHere = (row: (typeof meetings)[number]) =>
    (row.eventId !== null && eventIds.includes(row.eventId)) ||
    (row.activityId !== null && activityIds.includes(row.activityId) && savedAt !== null && row.createdAt >= savedAt);
  const dropMeetings = meetings.filter(madeHere).map((row) => row.id);
  const resetMeetings = meetings.filter((row) => !madeHere(row)).map((row) => row.id);
  const opportunityIds = [...new Set(meetings.map((row) => row.opportunityId))];

  // The history line a Pipeline Held / No-show changed that this save did
  // not write: its outcome goes back to "not recorded".
  let earlierLineIds: string[] = [];
  if (meetingRow?.activityId && !activityIds.includes(meetingRow.activityId)) {
    const line = await prisma.activity.findFirst({
      where: { id: meetingRow.activityId, organizationId },
      select: { id: true, batchId: true },
    });
    if (line) {
      earlierLineIds = line.batchId
        ? (await prisma.activity.findMany({ where: { organizationId, batchId: line.batchId }, select: { id: true } })).map((row) => row.id)
        : [line.id];
    }
  }

  // Where each record's statuses started and ended in this save.
  type Chain = { kind: "contact" | "company"; id: string; start: string; end: string };
  const chains: Chain[] = [];
  const groups = new Map<string, typeof changes>();
  for (const row of changes) {
    const key = row.contactId ? `contact:${row.contactId}` : row.companyId ? `company:${row.companyId}` : null;
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const [key, rows] of groups) {
    const tos = new Set(rows.map((row) => row.toStatus));
    const froms = new Set(rows.map((row) => row.fromStatus ?? ""));
    const start = rows.find((row) => !tos.has(row.fromStatus ?? ""))?.fromStatus ?? rows[0].fromStatus;
    const end = rows.find((row) => !froms.has(row.toStatus))?.toStatus ?? rows[rows.length - 1].toStatus;
    const [kind, id] = key.split(":") as ["contact" | "company", string];
    if (start) chains.push({ kind, id, start, end });
  }

  await prisma.$transaction(
    async (tx) => {
      // Entries the save ticked done keep themselves: unlink first, since
      // deleting a line deletes the entry linked to it.
      if (activityIds.length) {
        await tx.calendarEvent.updateMany({
          where: { organizationId, activityId: { in: activityIds }, OR: [{ batchId: null }, { batchId: { not: batchId } }] },
          data: { activityId: null, doneAt: null },
        });
      }
      if (dropMeetings.length) await tx.opportunityMeeting.deleteMany({ where: { id: { in: dropMeetings } } });
      if (resetMeetings.length) {
        await tx.opportunityMeeting.updateMany({
          where: { id: { in: resetMeetings } },
          data: { outcome: null },
        });
        await tx.opportunityMeeting.updateMany({
          where: { id: { in: resetMeetings }, activityId: { in: activityIds.length ? activityIds : ["-"] } },
          data: { activityId: null },
        });
      }
      if (earlierLineIds.length) {
        await tx.activity.updateMany({ where: { organizationId, id: { in: earlierLineIds } }, data: { outcome: null } });
      }

      for (const opportunityId of opportunityIds) {
        const opportunity = await tx.opportunity.findFirst({
          where: { id: opportunityId, organizationId },
          select: { id: true, stage: true, dealId: true, completedAt: true, createdAt: true, _count: { select: { meetings: true } } },
        });
        if (!opportunity || !savedAt) continue;
        if (!opportunity.dealId && opportunity._count.meetings === 0 && opportunity.createdAt >= savedAt) {
          await tx.opportunity.deleteMany({ where: { id: opportunity.id, organizationId } });
          continue;
        }
        await tx.opportunityContact.deleteMany({
          where: { opportunityId: opportunity.id, fromMeeting: true, createdAt: { gte: savedAt }, role: { not: "PRIMARY" } },
        });
        if (!opportunity.dealId && opportunity.stage === "MEETING_COMPLETED" && opportunity.completedAt && began && opportunity.completedAt >= began) {
          await tx.opportunity.updateMany({
            where: { id: opportunity.id, organizationId },
            data: { stage: "MEETING_SET", completedAt: null },
          });
          await tx.opportunityLog.deleteMany({
            where: { opportunityId: opportunity.id, kind: "OPPORTUNITY_CREATED", occurredAt: opportunity.completedAt },
          });
        }
      }

      for (const chain of chains) {
        if (chain.kind === "contact") {
          await tx.$executeRaw`UPDATE "Contact" SET status = ${chain.start}::"ContactStatus"
                               WHERE id = ${chain.id} AND "organizationId" = ${organizationId} AND status = ${chain.end}::"ContactStatus"`;
        } else {
          await tx.$executeRaw`UPDATE "Company" SET status = ${chain.start}::"ContactStatus"
                               WHERE id = ${chain.id} AND "organizationId" = ${organizationId} AND status = ${chain.end}::"ContactStatus"`;
        }
      }
      if (changes.length) await tx.statusChange.deleteMany({ where: { organizationId, batchId } });
      if (eventIds.length) await tx.calendarEvent.deleteMany({ where: { organizationId, batchId } });
      if (activityIds.length) await tx.activity.deleteMany({ where: { organizationId, batchId } });
    },
    { timeout: 20_000 },
  );

  return {
    ok: true,
    contactIds: [
      ...new Set([
        ...activities.map((row) => row.contactId),
        ...changes.map((row) => row.contactId),
      ].filter((id): id is string => Boolean(id))),
    ],
    companyIds: [
      ...new Set([
        ...activities.map((row) => row.companyId),
        ...changes.map((row) => row.companyId),
      ].filter((id): id is string => Boolean(id))),
    ],
    opportunityIds,
    removed: activities.length,
  };
}
