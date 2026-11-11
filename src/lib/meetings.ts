import { prisma } from "@/lib/prisma";
import { DEFAULT_TIME_ZONE, formatDay } from "@/lib/format";
import { isoToDate, todayIso } from "@/lib/payments";
import { zonedNoon } from "@/lib/money";
import { formatTime } from "@/lib/calendar";
import { ensureEventType } from "@/lib/event-types";
import { ACTIVITY_EVENT_TYPE } from "@/lib/constants";
import { dayInZone, zonedMoment } from "@/lib/calendar-auto";
import { markConnected, markContacted, markMeetingSet, type Who } from "@/lib/status";
import { CONVERTED_STAGES, opportunityColumn, syncOpportunity } from "@/lib/opportunities";
import { answerOf, waitingOf, type MeetingAnswer, type MeetingFact } from "@/lib/meeting-rule";
import { stashMeeting } from "@/lib/undo-log";

// Meetings on the Pipeline (BDR redesign, Nov 11, 2026): Held, No-show,
// Reschedule and Book, the rules every screen shares. Not "use server":
// each takes an organizationId and must never be callable from a browser.
//
// - Held sets HELD on the meeting's own history line when it has one (the
//   activity it was logged as, or the one its calendar entry was ticked
//   done with) and writes a MEETING line only when there is none, so a
//   meeting is never counted twice. Everyone in it is Connected, and the
//   tile and its people move to Meeting Completed (decision 4).
// - No-show keeps Meeting Set; the meeting and its line read NO_SHOW,
//   which is neither a touch nor a connect.
// - Reschedule moves a meeting still to come; one whose day has gone by
//   without happening is a no-show and a new one is booked.
// - Booking writes "Meeting · <name>" on the calendar and runs the same
//   steps as every other meeting (markMeetingSet / attachMeeting), with the
//   rep who booked it kept on the meeting.

type Actor = Who & { userId: string };

async function zoneOf(organizationId: string) {
  const row = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timeZone: true } });
  return row?.timeZone ?? DEFAULT_TIME_ZONE;
}

async function loadMeeting(organizationId: string, meetingId: string) {
  return prisma.opportunityMeeting.findFirst({
    where: { id: meetingId, opportunity: { organizationId } },
    select: {
      id: true,
      on: true,
      activityId: true,
      eventId: true,
      outcome: true,
      opportunityId: true,
      opportunity: {
        select: {
          id: true,
          title: true,
          stage: true,
          dealId: true,
          deal: { select: { stage: true } },
          contacts: { orderBy: { createdAt: "asc" }, select: { contactId: true, role: true } },
        },
      },
    },
  });
}
type MeetingRow = NonNullable<Awaited<ReturnType<typeof loadMeeting>>>;

async function loadEvent(organizationId: string, eventId: string | null) {
  if (!eventId) return null;
  return prisma.calendarEvent.findFirst({
    where: { id: eventId, organizationId },
    select: {
      id: true,
      title: true,
      notes: true,
      startOn: true,
      startTime: true,
      contactId: true,
      companyId: true,
      activityId: true,
      doneAt: true,
      location: true,
      attendees: { select: { id: true } },
    },
  });
}
type EventRow = NonNullable<Awaited<ReturnType<typeof loadEvent>>>;

// The meeting's own history line and the rest of its batch (one row per
// person in it), when it has one.
async function linkedLines(organizationId: string, meeting: MeetingRow, event: EventRow | null) {
  const activityId = meeting.activityId ?? event?.activityId ?? null;
  if (!activityId) return [];
  const first = await prisma.activity.findFirst({
    where: { id: activityId, organizationId },
    select: { id: true, batchId: true, type: true },
  });
  if (!first || first.type !== "MEETING") return [];
  return prisma.activity.findMany({
    where: { organizationId, ...(first.batchId ? { batchId: first.batchId } : { id: first.id }) },
    select: { id: true, contactId: true, companyId: true, occurredAt: true, outcome: true },
  });
}

// The day the meeting is on in the workspace's clock, and its moment.
function whenOf(meeting: MeetingRow, event: EventRow | null, timeZone: string) {
  if (event) {
    const day = event.startOn.toISOString().slice(0, 10);
    const moment = event.startTime ? zonedMoment(day, event.startTime, timeZone) : zonedMoment(day, "12:00", timeZone);
    return { day, moment };
  }
  return { day: dayInZone(meeting.on, timeZone), moment: meeting.on };
}

function peopleOf(meeting: MeetingRow, event: EventRow | null) {
  if (event) {
    const ids = [event.contactId, ...event.attendees.map((row) => row.id)].filter((id): id is string => Boolean(id));
    if (ids.length) return [...new Set(ids)];
  }
  return meeting.opportunity.contacts.filter((row) => row.role !== "HIDDEN").map((row) => row.contactId);
}

export type HeldResult =
  | { ok: true; opportunityId: string; contactIds: string[]; already?: boolean }
  | { confirmEarly: string }
  | { error: string };

// Held. `early` answers "This meeting is Tue Nov 17. Did it happen early?"
// for a meeting whose day is still ahead; without it such a meeting is
// handed back as { confirmEarly: day } and nothing is written.
export async function recordMeetingHeld(who: Actor, meetingId: string, options: { early?: boolean; note?: string } = {}): Promise<HeldResult> {
  const { organizationId } = who;
  const meeting = await loadMeeting(organizationId, meetingId);
  if (!meeting) return { error: "That meeting is no longer on the board" };
  const timeZone = await zoneOf(organizationId);
  const event = await loadEvent(organizationId, meeting.eventId);
  const lines = await linkedLines(organizationId, meeting, event);
  const today = todayIso(timeZone);
  const now = new Date();

  let at: Date;
  if (lines.length) {
    at = lines[0].occurredAt;
  } else {
    const { day, moment } = whenOf(meeting, event, timeZone);
    if (day > today && !options.early) return { confirmEarly: day };
    at = moment > now || day > today ? now : moment;
  }
  if (at > now) {
    // A line dated ahead (logged for later) that happened early.
    if (!options.early) return { confirmEarly: dayInZone(at, timeZone) };
    at = now;
  }

  // What Undo puts back (only this save's, only by its owner).
  await stashMeeting(organizationId, meeting.id, who);
  let contactIds: string[];
  let companyId: string | null = null;
  if (lines.length) {
    await prisma.activity.updateMany({
      where: { organizationId, id: { in: lines.map((row) => row.id) } },
      data: { outcome: "HELD", ...(lines[0].occurredAt > now ? { occurredAt: at } : {}) },
    });
    contactIds = [...new Set(lines.map((row) => row.contactId).filter((id): id is string => Boolean(id)))];
    if (!contactIds.length) companyId = lines[0].companyId;
  } else {
    contactIds = peopleOf(meeting, event);
    const owned = await prisma.contact.findMany({ where: { organizationId, id: { in: contactIds } }, select: { id: true } });
    const ownedIds = new Set(owned.map((row) => row.id));
    contactIds = contactIds.filter((id) => ownedIds.has(id));
    if (!contactIds.length && !event?.companyId) return { error: "Nobody is on this meeting to log it on" };
    const body = options.note?.trim() || event?.notes.trim() || event?.title || `Meeting held · ${meeting.opportunity.title}`;
    const rows = contactIds.length
      ? contactIds.map((contactId) => ({ contactId, companyId: null as string | null }))
      : [{ contactId: null as string | null, companyId: event!.companyId }];
    if (!contactIds.length) companyId = event!.companyId;
    const written = await prisma.$transaction(
      rows.map((row) =>
        prisma.activity.create({
          data: {
            organizationId,
            contactId: row.contactId,
            companyId: row.companyId,
            userId: who.userId,
            type: "MEETING",
            outcome: "HELD",
            body,
            batchId: who.batchId ?? null,
            occurredAt: at,
          },
          select: { id: true },
        }),
      ),
    );
    if (event && !event.activityId) {
      await prisma.calendarEvent.updateMany({
        where: { id: event.id, organizationId, activityId: null },
        data: { activityId: written[0].id, doneAt: event.doneAt ?? at },
      });
    }
    await prisma.opportunityMeeting.update({ where: { id: meeting.id }, data: { activityId: written[0].id } });
  }
  await prisma.opportunityMeeting.update({ where: { id: meeting.id }, data: { outcome: "HELD" } });

  await markContacted(who, { contactIds, companyId }, at);
  await markConnected(who, { contactIds, companyId }, at);

  const deal = meeting.opportunity.deal;
  if ((!deal || !CONVERTED_STAGES.includes(deal.stage)) && meeting.opportunity.stage === "MEETING_SET") {
    await prisma.opportunity.updateMany({
      where: { id: meeting.opportunityId, organizationId, stage: "MEETING_SET" },
      data: { stage: "MEETING_COMPLETED" },
    });
  }
  await syncOpportunity(who, meeting.opportunityId);
  return { ok: true, opportunityId: meeting.opportunityId, contactIds, already: meeting.outcome === "HELD" };
}

// No-show: the meeting and its history line read NO_SHOW (not a touch,
// not a connect), its calendar entry is ticked off, and nobody's status
// moves — they stay Meeting Set.
export async function recordMeetingNoShow(who: Actor, meetingId: string): Promise<{ ok: true; opportunityId: string } | { error: string }> {
  const { organizationId } = who;
  const meeting = await loadMeeting(organizationId, meetingId);
  if (!meeting) return { error: "That meeting is no longer on the board" };
  if (meeting.outcome === "HELD") return { error: "That meeting is marked held. Undo that first." };
  const timeZone = await zoneOf(organizationId);
  const event = await loadEvent(organizationId, meeting.eventId);
  const { day } = whenOf(meeting, event, timeZone);
  if (day > todayIso(timeZone)) return { error: "That meeting hasn't happened yet. Reschedule it instead." };
  const lines = await linkedLines(organizationId, meeting, event);
  await stashMeeting(organizationId, meeting.id, who);
  await prisma.$transaction([
    ...(lines.length
      ? [prisma.activity.updateMany({ where: { organizationId, id: { in: lines.map((row) => row.id) } }, data: { outcome: "NO_SHOW" as const } })]
      : []),
    ...(event && !event.doneAt
      ? [prisma.calendarEvent.updateMany({ where: { id: event.id, organizationId }, data: { doneAt: new Date() } })]
      : []),
    prisma.opportunityMeeting.update({ where: { id: meeting.id }, data: { outcome: "NO_SHOW" } }),
  ]);
  return { ok: true, opportunityId: meeting.opportunityId };
}

// Books a meeting: "Meeting · <name>" on the calendar under whoever booked
// it, with the people on it, and the same steps as every meeting path —
// Meeting Set (through Connected from below it), the opportunity, and the
// booker kept on the meeting. `on` is today or later (checked by callers).
export async function bookMeetingCore(
  who: Actor,
  input: {
    contactIds: string[];
    companyId: string | null;
    on: string;
    time: string | null;
    where?: string | null;
    note?: string | null;
    opportunity?: string | null;
  },
) {
  const { organizationId } = who;
  const timeZone = await zoneOf(organizationId);
  const people = await prisma.contact.findMany({
    where: { organizationId, id: { in: input.contactIds } },
    select: { id: true, name: true, companyId: true },
  });
  const byId = new Map(people.map((row) => [row.id, row]));
  const contactIds = input.contactIds.filter((id) => byId.has(id));
  if (!contactIds.length) return { error: "Pick who the meeting is with" as const };
  const first = byId.get(contactIds[0])!;
  const type = (await ensureEventType(organizationId, ACTIVITY_EVENT_TYPE.MEETING)) ?? ACTIVITY_EVENT_TYPE.MEETING;
  const event = await prisma.calendarEvent.create({
    data: {
      organizationId,
      ownerId: who.userId,
      type,
      title: `${type} · ${first.name}`,
      startOn: isoToDate(input.on)!,
      startTime: input.time,
      location: input.where?.trim() || null,
      notes: input.note?.trim() ?? "",
      contactId: first.id,
      companyId: input.companyId ?? first.companyId,
      batchId: who.batchId ?? null,
      attendees: { connect: contactIds.slice(1).map((id) => ({ id })) },
    },
    select: { id: true },
  });
  const meetingAt = input.time ? zonedMoment(input.on, input.time, timeZone) : zonedNoon(input.on, timeZone);
  const opportunityId = await markMeetingSet(who, contactIds, new Date(), { on: meetingAt, eventId: event.id, opportunity: input.opportunity ?? null });
  const when = `${formatDay(`${input.on}T12:00:00Z`)}${input.time ? `, ${formatTime(input.time)}` : ""}`;
  // "your Pipeline" only when the tile is the booker's (Mine shows it): a
  // meeting added to a teammate's open opportunity keeps their rep.
  const yours = await isTheirTile(organizationId, opportunityId, who.userId);
  return {
    eventId: event.id,
    opportunityId,
    contactIds,
    yours,
    message: `Booked ${when} · ${first.name} is on ${yours ? "your" : "the"} Pipeline in Meeting Set`,
  };
}

// Whether the tile is this user's, as the Pipeline's Mine reads it (the
// deal's rep once there is a deal, else the opportunity's).
async function isTheirTile(organizationId: string, opportunityId: string | null, userId: string) {
  if (!opportunityId) return true;
  const tile = await prisma.opportunity.findFirst({
    where: { id: opportunityId, organizationId },
    select: { ownerId: true, deal: { select: { ownerId: true } } },
  });
  if (!tile) return true;
  return (tile.deal ? tile.deal.ownerId : tile.ownerId) === userId;
}

// Reschedule. A meeting still to come (and not a no-show) moves: its
// calendar entry and its date. One whose day has gone by without being
// marked held is a no-show, and a new meeting is booked on the same tile.
export async function rescheduleMeetingCore(
  who: Actor,
  meetingId: string,
  input: { on: string; time: string | null },
): Promise<{ ok: true; opportunityId: string; message: string; meetingId: string } | { error: string }> {
  const { organizationId } = who;
  const meeting = await loadMeeting(organizationId, meetingId);
  if (!meeting) return { error: "That meeting is no longer on the board" };
  if (meeting.outcome === "HELD") return { error: "That meeting was held. Book a new one instead." };
  const timeZone = await zoneOf(organizationId);
  const today = todayIso(timeZone);
  if (input.on < today) return { error: "Pick today or a day ahead" };
  const event = await loadEvent(organizationId, meeting.eventId);
  const { day } = whenOf(meeting, event, timeZone);
  const when = `${formatDay(`${input.on}T12:00:00Z`)}${input.time ? `, ${formatTime(input.time)}` : ""}`;
  const ahead = day >= today && meeting.outcome !== "NO_SHOW";
  // A meeting still to come that already carries a history line nobody
  // answered (logged for later today, or put back to "not recorded"):
  // the line was a plan, not what happened (final audit M16, Nov 11, 2026).
  // It used to stay behind beside the new booking, so once its time passed
  // Stats counted it held, as a try and a talk, and credited two bookings.
  // Moving the meeting takes it with it: a line dated ahead goes (nothing
  // is history until it has happened), one already past reads No-show (it
  // was put off, so it didn't happen then), and the meeting row moves.
  const lines = await linkedLines(organizationId, meeting, event);
  const now = new Date();
  const loose = ahead && !meeting.outcome && lines.length > 0 && lines.every((row) => answerOf(null, row.outcome) === null) ? lines : [];
  const settleLoose = loose.length
    ? [
        prisma.activity.deleteMany({ where: { organizationId, id: { in: loose.filter((row) => row.occurredAt > now).map((row) => row.id) } } }),
        prisma.activity.updateMany({
          where: { organizationId, id: { in: loose.filter((row) => row.occurredAt <= now).map((row) => row.id) } },
          data: { outcome: "NO_SHOW" as const },
        }),
      ]
    : [];

  if (ahead && event && (!event.activityId || loose.length)) {
    const at = input.time ? zonedMoment(input.on, input.time, timeZone) : zonedNoon(input.on, timeZone);
    await prisma.$transaction([
      // Unlinked before its line can go: deleting a line deletes the entry
      // linked to it.
      prisma.calendarEvent.updateMany({
        where: { id: event.id, organizationId },
        data: { startOn: isoToDate(input.on)!, endOn: null, startTime: input.time, doneAt: null, ...(loose.length ? { activityId: null } : {}) },
      }),
      prisma.opportunityMeeting.update({ where: { id: meeting.id }, data: { on: at, outcome: null, ...(loose.length ? { activityId: null } : {}) } }),
      ...settleLoose,
    ]);
    return { ok: true, opportunityId: meeting.opportunityId, meetingId: meeting.id, message: `Moved to ${when}` };
  }

  // Still to come with nothing to move (no calendar entry of its own): the
  // new booking replaces it. Gone by: it didn't happen, so it is a no-show.
  if (!ahead && !meeting.outcome) {
    const missed = await recordMeetingNoShow(who, meeting.id);
    if ("error" in missed) return missed;
  }
  const people = lines.length
    ? [...new Set(lines.map((row) => row.contactId).filter((id): id is string => Boolean(id)))]
    : peopleOf(meeting, event);
  const booked = await bookMeetingCore(who, {
    contactIds: people,
    companyId: event?.companyId ?? null,
    on: input.on,
    time: input.time,
    where: event?.location ?? null,
    note: event?.notes ?? null,
    opportunity: meeting.opportunityId,
  });
  if ("error" in booked) return { error: booked.error ?? "That couldn't be booked" };
  if (ahead && (!meeting.activityId || loose.length)) {
    await prisma.$transaction([...settleLoose, prisma.opportunityMeeting.deleteMany({ where: { id: meeting.id } })]);
  }
  const fresh = await prisma.opportunityMeeting.findFirst({
    where: { opportunityId: meeting.opportunityId, eventId: booked.eventId },
    select: { id: true },
  });
  return {
    ok: true,
    opportunityId: booked.opportunityId ?? meeting.opportunityId,
    meetingId: fresh?.id ?? meeting.id,
    message: `Rescheduled to ${when}`,
  };
}

/* ---------------------- Which meeting is waiting ---------------------- */

export type WaitingMeeting = {
  // The OpportunityMeeting, the tile it is on, and its calendar entry.
  id: string;
  opportunityId: string;
  title: string;
  eventId: string | null;
  at: Date;
  // The workspace's day and "HH:MM", from the calendar entry when it has
  // one (a booked meeting with no time stays untimed).
  day: string;
  time: string | null;
  outcome: MeetingAnswer;
};

export type Waiting = {
  ahead: WaitingMeeting | null;
  last: WaitingMeeting | null;
  due: WaitingMeeting | null;
  missed: WaitingMeeting | null;
  toAnswer: WaitingMeeting | null;
};

// The meetings waiting for an answer, per person or per tile, by the one
// rule in src/lib/meeting-rule.ts. A person's are the meetings on every
// tile they are on as Primary or Associated (Do Not List is not on it);
// a tile's are its own. Three statements for the whole batch, scoped to
// the workspace. Every key asked for comes back (empty when it has none).
export async function waitingMeetings(
  organizationId: string,
  by: { contactIds: string[] } | { opportunityIds: string[] },
  options: { now?: Date; timeZone?: string } = {},
): Promise<Map<string, Waiting>> {
  const byContact = "contactIds" in by;
  const keys = Array.from(new Set(byContact ? by.contactIds : by.opportunityIds)).filter(Boolean);
  const result = new Map<string, Waiting>();
  const empty: Waiting = { ahead: null, last: null, due: null, missed: null, toAnswer: null };
  for (const key of keys) result.set(key, empty);
  if (!keys.length) return result;
  const now = options.now ?? new Date();
  const [timeZone, rows] = await Promise.all([
    options.timeZone ?? zoneOf(organizationId),
    prisma.opportunityMeeting.findMany({
      where: byContact
        ? { opportunity: { organizationId, contacts: { some: { contactId: { in: keys }, role: { not: "HIDDEN" } } } } }
        : { opportunityId: { in: keys }, opportunity: { organizationId } },
      select: {
        id: true,
        on: true,
        outcome: true,
        activityId: true,
        eventId: true,
        opportunityId: true,
        opportunity: {
          select: {
            title: true,
            stage: true,
            deal: { select: { stage: true } },
            // The people asked about who are on it (none when asking by tile).
            contacts: { where: { contactId: { in: byContact ? keys : [] }, role: { not: "HIDDEN" } }, select: { contactId: true } },
          },
        },
      },
    }),
  ]);
  if (!rows.length) return result;
  const activityIds = [...new Set(rows.map((row) => row.activityId).filter((id): id is string => Boolean(id)))];
  const eventIds = [...new Set(rows.map((row) => row.eventId).filter((id): id is string => Boolean(id)))];
  const [lines, events] = await Promise.all([
    activityIds.length
      ? prisma.activity.findMany({ where: { organizationId, id: { in: activityIds } }, select: { id: true, outcome: true } })
      : Promise.resolve([]),
    eventIds.length
      ? prisma.calendarEvent.findMany({ where: { organizationId, id: { in: eventIds } }, select: { id: true, startOn: true, startTime: true } })
      : Promise.resolve([]),
  ]);
  const loggedAs = new Map(lines.map((row) => [row.id, row.outcome]));
  const eventById = new Map(events.map((row) => [row.id, row]));

  const facts = new Map<string, MeetingFact<WaitingMeeting>[]>();
  for (const row of rows) {
    const event = row.eventId ? eventById.get(row.eventId) : undefined;
    const outcome = answerOf(row.outcome, row.activityId ? loggedAs.get(row.activityId) : null);
    // The moment is the calendar entry's, in the workspace's clock, when it
    // has one (as whenOf reads it): rows the calendar form wrote before the
    // Nov 11 audit hold midnight UTC, the evening before in the US, so a
    // 4pm meeting read as already happened from 7pm the night before.
    const eventDay = event ? event.startOn.toISOString().slice(0, 10) : null;
    const at = event && eventDay ? zonedMoment(eventDay, event.startTime ?? "12:00", timeZone) : row.on;
    const meeting: WaitingMeeting = {
      id: row.id,
      opportunityId: row.opportunityId,
      title: row.opportunity.title,
      eventId: row.eventId,
      at,
      day: eventDay ?? dayInZone(row.on, timeZone),
      time: event?.startTime ?? null,
      outcome,
    };
    const column = opportunityColumn(row.opportunity);
    const fact = {
      item: meeting,
      at: at.getTime(),
      outcome,
      meetingSet: column === "MEETING_SET",
      // Asking about one tile, it is the one; a person's Won or Lost tiles
      // are history.
      open: !byContact || (column !== "WON" && column !== "LOST"),
    };
    const owners = byContact ? row.opportunity.contacts.map((link) => link.contactId) : [row.opportunityId];
    for (const key of owners) {
      const list = facts.get(key) ?? [];
      list.push(fact);
      facts.set(key, list);
    }
  }
  for (const [key, list] of facts) {
    const waiting = waitingOf(list, now.getTime());
    result.set(key, { ...waiting, last: waiting.last?.item ?? null });
  }
  return result;
}

// The meeting row a logged or ticked meeting landed on, for Held.
export async function meetingFor(organizationId: string, opportunityId: string | null, activityId: string) {
  if (!opportunityId) return null;
  const row = await prisma.opportunityMeeting.findFirst({
    where: { opportunityId, activityId, opportunity: { organizationId } },
    select: { id: true },
  });
  return row?.id ?? null;
}

/* ------------------- What the meeting server actions answer ------------------- */

// The three Pipeline meeting actions in opportunity-actions.ts are these,
// after the session and the input are checked; kept here so they can be
// exercised without a browser (connected.cjs) and read in one place. Each
// save's batchId is "m:<meetingId>:<uuid>" (meetingBatchId), which
// undoLog understands.

export async function meetingHeldAnswer(
  actor: { organizationId: string; userId: string },
  meetingId: string,
  options: { early?: boolean; note?: string },
): Promise<{ error?: string; success?: string; batchId?: string; confirmEarly?: string; opportunityId?: string; contactIds?: string[] }> {
  const { meetingBatchId } = await import("@/lib/undo-log");
  const batchId = meetingBatchId(meetingId);
  const result = await recordMeetingHeld({ ...actor, batchId }, meetingId, options);
  if ("error" in result) return { error: result.error };
  if ("confirmEarly" in result) {
    return { confirmEarly: result.confirmEarly, error: `This meeting is ${formatDay(`${result.confirmEarly}T12:00:00Z`)}. Did it happen early?` };
  }
  return {
    success: result.already ? "Already marked held" : "Held · Meeting Completed",
    batchId,
    opportunityId: result.opportunityId,
    contactIds: result.contactIds,
  };
}

export async function meetingNoShowAnswer(
  actor: { organizationId: string; userId: string },
  meetingId: string,
): Promise<{ error?: string; success?: string; batchId?: string }> {
  const { meetingBatchId } = await import("@/lib/undo-log");
  const batchId = meetingBatchId(meetingId);
  const result = await recordMeetingNoShow({ ...actor, batchId }, meetingId);
  if ("error" in result) return { error: result.error };
  return { success: "No-show · still Meeting Set", batchId };
}

export async function meetingRescheduleAnswer(
  actor: { organizationId: string; userId: string },
  meetingId: string,
  input: { on: string; time: string | null },
): Promise<{ error?: string; success?: string; meetingId?: string; batchId?: string; opportunityId?: string }> {
  const { meetingBatchId } = await import("@/lib/undo-log");
  const batchId = meetingBatchId(meetingId);
  const result = await rescheduleMeetingCore({ ...actor, batchId }, meetingId, input);
  if ("error" in result) return { error: result.error };
  return {
    success: result.message,
    meetingId: result.meetingId,
    opportunityId: result.opportunityId,
    ...(result.meetingId !== meetingId ? { batchId } : {}),
  };
}
