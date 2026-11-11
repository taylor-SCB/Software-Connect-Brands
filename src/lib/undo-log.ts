import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
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

// What a save found on a meeting before it answered it (Held, No-show, a
// meeting logged on its booked day), kept on the meeting
// (OpportunityMeeting.outcomeUndo, final audit Nov 11, 2026). Only the
// first write of a save is kept, so a save that touches the meeting twice
// (logged, then held) restores what was there before either. Undo restores
// it only for that save: a later save's answer is never undone by an
// earlier save's Undo, and a meeting action's owner is whoever made it.
export type MeetingStash = {
  batchId: string;
  by: string | null;
  outcome: string | null;
  on: string;
  activityId: string | null;
  event: { id: string; doneAt: string | null } | null;
  lines: { id: string; outcome: string | null; occurredAt: string }[];
};

function readStash(value: unknown): MeetingStash | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<MeetingStash>;
  return typeof row.batchId === "string" && typeof row.on === "string" ? (row as MeetingStash) : null;
}

export async function stashMeeting(organizationId: string, meetingId: string, who: { batchId?: string | null; userId?: string | null }) {
  if (!who.batchId) return;
  const meeting = await prisma.opportunityMeeting.findFirst({
    where: { id: meetingId, opportunity: { organizationId } },
    select: { id: true, on: true, outcome: true, activityId: true, eventId: true, outcomeUndo: true },
  });
  if (!meeting || readStash(meeting.outcomeUndo)?.batchId === who.batchId) return;
  const [event, first] = await Promise.all([
    meeting.eventId
      ? prisma.calendarEvent.findFirst({ where: { id: meeting.eventId, organizationId }, select: { id: true, doneAt: true, activityId: true } })
      : Promise.resolve(null),
    meeting.activityId
      ? prisma.activity.findFirst({ where: { id: meeting.activityId, organizationId }, select: { id: true, batchId: true } })
      : Promise.resolve(null),
  ]);
  const lineId = first?.id ?? event?.activityId ?? null;
  const head = first ?? (lineId ? await prisma.activity.findFirst({ where: { id: lineId, organizationId }, select: { id: true, batchId: true } }) : null);
  const lines = head
    ? await prisma.activity.findMany({
        where: { organizationId, ...(head.batchId ? { batchId: head.batchId } : { id: head.id }) },
        select: { id: true, outcome: true, occurredAt: true },
      })
    : [];
  const stash: MeetingStash = {
    batchId: who.batchId,
    by: who.userId ?? null,
    outcome: meeting.outcome,
    on: meeting.on.toISOString(),
    activityId: meeting.activityId,
    event: event ? { id: event.id, doneAt: event.doneAt?.toISOString() ?? null } : null,
    lines: lines.map((line) => ({ id: line.id, outcome: line.outcome, occurredAt: line.occurredAt.toISOString() })),
  };
  await prisma.opportunityMeeting.update({ where: { id: meeting.id }, data: { outcomeUndo: stash } });
}

// The meeting a calendar entry was booked as, for stashing before a log
// on that entry's day takes it over.
export async function stashMeetingForEvent(organizationId: string, eventId: string, who: { batchId?: string | null; userId?: string | null }) {
  const row = await prisma.opportunityMeeting.findFirst({
    where: { eventId, opportunity: { organizationId } },
    orderBy: { createdAt: "asc" },
    select: { id: true, opportunityId: true },
  });
  if (row) await stashMeeting(organizationId, row.id, who);
  return row;
}

// How long after a save began its own writes can still be landing (it is
// one request). Anything later on a tile is somebody's later work, which
// Undo never takes back.
const SAVE_WINDOW_MS = 120_000;

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
          select: { id: true, opportunityId: true, activityId: true, outcome: true, outcomeUndo: true },
        })
      : Promise.resolve(null),
  ]);
  // A meeting action is undoable only while the meeting still carries what
  // that very save did: a later answer (or an Undo already run, or a made-up
  // batchId) leaves nothing of it to take back.
  const meetingStash = meetingRow ? readStash(meetingRow.outcomeUndo) : null;
  const meetingSet = Boolean(meetingRow && meetingStash?.batchId === batchId);
  if (!activities.length && !events.length && !changes.length && !meetingSet) {
    return { error: "That has already been undone" };
  }
  if (activities.some((row) => row.marketing)) return { error: "A marketing email can't be undone. It went out." };
  const owner = activities[0]?.userId ?? events[0]?.ownerId ?? changes[0]?.userId ?? (meetingSet ? meetingStash?.by : null) ?? null;
  // Nobody on record (nothing it wrote names anyone): only an Owner or
  // Admin, never any teammate.
  if (!actor.canManage && owner !== actor.userId) {
    return { error: "Only whoever logged it, or an Owner or Admin, can undo it" };
  }

  const stamps = [...activities, ...events, ...changes].map((row) => row.createdAt.getTime());
  const savedAt = stamps.length ? new Date(Math.min(...stamps)) : null;
  // When the save began, by the clock that stamps completedAt.
  const began = startedAt(batchId) ?? savedAt;
  // The save's own writes land between when it began and shortly after its
  // last row; nothing a tile got after that is this save's. (Both ends are
  // stamped by this server's clock, as Prisma's createdAt is.)
  const from = began;
  const until = from ? new Date(Math.max(from.getTime(), ...stamps) + SAVE_WINDOW_MS) : null;
  const inSave = (date: Date | null | undefined) => Boolean(date && from && until && date >= from && date <= until);
  const activityIds = activities.map((row) => row.id);
  const eventIds = events.map((row) => row.id);

  const meetings = await prisma.opportunityMeeting.findMany({
    where: {
      opportunity: { organizationId },
      OR: [
        ...(activityIds.length ? [{ activityId: { in: activityIds } }] : []),
        ...(eventIds.length ? [{ eventId: { in: eventIds } }] : []),
        ...(meetingSet && meetingRow ? [{ id: meetingRow.id }] : []),
        { outcomeUndo: { path: ["batchId"], equals: batchId } },
      ],
    },
    select: { id: true, opportunityId: true, activityId: true, eventId: true, createdAt: true, outcomeUndo: true },
  });
  // Made by this save: booked with an entry it wrote, or written during it
  // for a line it wrote.
  // A meeting this save stashed was there before it.
  const madeHere = (row: (typeof meetings)[number]) =>
    readStash(row.outcomeUndo)?.batchId !== batchId &&
    ((row.eventId !== null && eventIds.includes(row.eventId)) ||
      (row.activityId !== null && activityIds.includes(row.activityId) && inSave(row.createdAt)));
  const dropMeetings = meetings.filter(madeHere).map((row) => row.id);
  const resetMeetings = meetings.filter((row) => !madeHere(row));
  const opportunityIds = [...new Set(meetings.map((row) => row.opportunityId))];

  // The history lines a meeting answer changed that this save did not
  // write: put back as the save found them (or, for a save from before the
  // stash existed, back to "not recorded").
  const lineRestores = new Map<string, { outcome: string | null; occurredAt: Date | null }>();
  const eventRestores = new Map<string, Date | null>();
  for (const row of resetMeetings) {
    const stash = readStash(row.outcomeUndo);
    if (stash?.batchId !== batchId) continue;
    for (const line of stash.lines) {
      if (!activityIds.includes(line.id)) lineRestores.set(line.id, { outcome: line.outcome, occurredAt: new Date(line.occurredAt) });
    }
    if (stash.event && !eventIds.includes(stash.event.id)) {
      eventRestores.set(stash.event.id, stash.event.doneAt ? new Date(stash.event.doneAt) : null);
    }
  }
  if (meetingRow && meetingSet && !meetingStash && meetingRow.activityId && !activityIds.includes(meetingRow.activityId)) {
    const line = await prisma.activity.findFirst({ where: { id: meetingRow.activityId, organizationId }, select: { id: true, batchId: true } });
    const ids = line?.batchId
      ? (await prisma.activity.findMany({ where: { organizationId, batchId: line.batchId }, select: { id: true } })).map((row) => row.id)
      : line
        ? [line.id]
        : [];
    for (const id of ids) lineRestores.set(id, { outcome: null, occurredAt: null });
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
  const contactChains = chains.filter((chain) => chain.kind === "contact");
  const companyChains = chains.filter((chain) => chain.kind === "company");

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
      for (const [id, doneAt] of eventRestores) {
        await tx.calendarEvent.updateMany({ where: { id, organizationId }, data: { doneAt } });
      }
      if (dropMeetings.length) await tx.opportunityMeeting.deleteMany({ where: { id: { in: dropMeetings } } });
      for (const row of resetMeetings) {
        const stash = readStash(row.outcomeUndo);
        const unlink = row.activityId && activityIds.includes(row.activityId) ? { activityId: null } : {};
        if (stash?.batchId === batchId) {
          // Back to what this save found.
          await tx.opportunityMeeting.update({
            where: { id: row.id },
            data: {
              outcome: stash.outcome as "HELD" | "NO_SHOW" | null,
              on: new Date(stash.on),
              activityId: stash.activityId && !activityIds.includes(stash.activityId) ? stash.activityId : null,
              outcomeUndo: Prisma.DbNull,
            },
          });
        } else if (stash) {
          // A later save answered it since: its answer stands.
          if ("activityId" in unlink) await tx.opportunityMeeting.update({ where: { id: row.id }, data: unlink });
        } else {
          // A save from before answers were kept: back to not recorded.
          await tx.opportunityMeeting.update({ where: { id: row.id }, data: { outcome: null, ...unlink } });
        }
      }
      for (const [id, line] of lineRestores) {
        await tx.activity.updateMany({
          where: { organizationId, id },
          data: { outcome: line.outcome as "HELD" | null, ...(line.occurredAt ? { occurredAt: line.occurredAt } : {}) },
        });
      }

      for (const opportunityId of opportunityIds) {
        const opportunity = await tx.opportunity.findFirst({
          where: { id: opportunityId, organizationId },
          select: { id: true, stage: true, dealId: true, completedAt: true, createdAt: true, _count: { select: { meetings: true } } },
        });
        if (!opportunity || !from) continue;
        if (!opportunity.dealId && opportunity._count.meetings === 0 && inSave(opportunity.createdAt)) {
          await tx.opportunity.deleteMany({ where: { id: opportunity.id, organizationId } });
          continue;
        }
        await tx.opportunityContact.deleteMany({
          where: { opportunityId: opportunity.id, fromMeeting: true, createdAt: { gte: from, lte: until! }, role: { not: "PRIMARY" } },
        });
        if (!opportunity.dealId && opportunity.stage === "MEETING_COMPLETED" && inSave(opportunity.completedAt)) {
          await tx.opportunity.updateMany({
            where: { id: opportunity.id, organizationId },
            data: { stage: "MEETING_SET", completedAt: null },
          });
          await tx.opportunityLog.deleteMany({
            where: { opportunityId: opportunity.id, kind: "OPPORTUNITY_CREATED", occurredAt: opportunity.completedAt! },
          });
        }
      }

      // Statuses back where the save found them, while still where it left
      // them: one statement a table, however many people.
      if (contactChains.length) {
        await tx.$executeRaw`UPDATE "Contact" c SET status = v.start::"ContactStatus"
                               FROM unnest(${contactChains.map((chain) => chain.id)}::text[], ${contactChains.map((chain) => chain.start)}::text[],
                                           ${contactChains.map((chain) => chain.end)}::text[]) AS v(id, start, fin)
                              WHERE c.id = v.id AND c."organizationId" = ${organizationId} AND c.status::text = v.fin`;
      }
      if (companyChains.length) {
        await tx.$executeRaw`UPDATE "Company" c SET status = v.start::"ContactStatus"
                               FROM unnest(${companyChains.map((chain) => chain.id)}::text[], ${companyChains.map((chain) => chain.start)}::text[],
                                           ${companyChains.map((chain) => chain.end)}::text[]) AS v(id, start, fin)
                              WHERE c.id = v.id AND c."organizationId" = ${organizationId} AND c.status::text = v.fin`;
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
