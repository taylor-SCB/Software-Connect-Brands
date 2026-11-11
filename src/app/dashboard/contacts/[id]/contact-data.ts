import { prisma } from "@/lib/prisma";
import { aheadDay, nextKindOf, pastDay, time12, zoneDay } from "@/lib/health";
import { answerOf } from "@/lib/meeting-rule";
import { zonedMoment } from "@/lib/calendar-auto";
import { waitingMeetings, type WaitingMeeting } from "@/lib/meetings";

// What the contact page's header and Next step strip need to act on a
// meeting (BDR redesign, Nov 11, 2026): the meeting that has happened and
// nobody marked yet ("Met Nov 6 — how did it go?"), the next one still to
// come ("Meeting Tue 10:00 AM" with Reschedule), and the no-show to book
// again. A meeting on the Pipeline is an OpportunityMeeting, read by the
// one rule every screen shares (waitingMeetings, src/lib/meeting-rule.ts:
// only tiles they are on as Primary or Associated, a "Met …" only from a
// tile at Meeting Set and only with nothing booked ahead, a calendar tick
// alone answers nothing). Held / No-show / Reschedule go through
// deals/opportunity-actions.ts. A meeting only on the calendar (an entry
// from before every meeting landed on the Pipeline) is a CalendarEvent of
// type Meeting: Held / No-show through the calendar's Done box, Move
// through moveEvent; it asks "how did it go?" only while they are at
// Meeting Set. A handful of statements, all scoped to the workspace.

export type ContactMeeting = {
  // OpportunityMeeting id, when it is on the Pipeline, and its tile.
  meetingId: string | null;
  opportunityId: string | null;
  // Its calendar entry, when it has one.
  eventId: string | null;
  // yyyy-mm-dd and "HH:MM" on the workspace's clock.
  on: string;
  time: string | null;
  // "Tue 10:00 AM", "Nov 6": the words the buttons and strip use.
  when: string;
  title: string;
  due: boolean;
};

export async function loadContactMeetings(
  organizationId: string,
  contactId: string,
  timeZone: string,
  now: Date = new Date(),
  options: { meetingSet?: boolean } = {},
): Promise<{ due: ContactMeeting | null; next: ContactMeeting | null; missed: ContactMeeting | null }> {
  const today = zoneDay(now, timeZone);
  const [waitingMap, events] = await Promise.all([
    waitingMeetings(organizationId, { contactIds: [contactId] }, { now, timeZone }),
    // Meetings on the calendar with them, open (not ticked done).
    prisma.calendarEvent.findMany({
      where: {
        organizationId,
        doneAt: null,
        type: { equals: "Meeting", mode: "insensitive" },
        OR: [{ contactId }, { attendees: { some: { id: contactId } } }],
      },
      orderBy: [{ startOn: "desc" }],
      take: 40,
      select: { id: true, title: true, startOn: true, startTime: true },
    }),
  ]);
  const waiting = waitingMap.get(contactId);
  // An entry a Pipeline meeting stands behind is read through that meeting.
  const covered = events.length
    ? new Set(
        (
          await prisma.opportunityMeeting.findMany({
            where: { eventId: { in: events.map((row) => row.id) }, opportunity: { organizationId } },
            select: { eventId: true },
          })
        ).map((row) => row.eventId),
      )
    : new Set<string | null>();
  const loose = events
    .filter((event) => !covered.has(event.id))
    .map((event) => {
      const on = event.startOn.toISOString().slice(0, 10);
      // Due once its moment has come (midday for an untimed one), as a
      // Pipeline meeting is.
      const moment = zonedMoment(on, event.startTime ?? "12:00", timeZone);
      return make(null, null, event.id, on, event.startTime, event.title, moment.getTime() <= now.getTime(), today);
    });

  const fromPipeline = (row: WaitingMeeting, due: boolean) => make(row.id, row.opportunityId, row.eventId, row.day, row.time, row.title, due, today);
  const order = (row: ContactMeeting) => `${row.on} ${row.time ?? "12:00"}`;
  const aheadOnes = [...(waiting?.ahead ? [fromPipeline(waiting.ahead, false)] : []), ...loose.filter((row) => !row.due)].sort((a, b) =>
    order(a).localeCompare(order(b)),
  );
  const next = aheadOnes[0] ?? null;
  // Nothing is asked about while a meeting is booked ahead.
  if (next) return { due: null, next, missed: null };
  const looseDue = options.meetingSet ? (loose.filter((row) => row.due).sort((a, b) => order(b).localeCompare(order(a)))[0] ?? null) : null;
  return {
    due: waiting?.due ? fromPipeline(waiting.due, true) : looseDue,
    next: null,
    missed: waiting?.missed ? fromPipeline(waiting.missed, true) : null,
  };
}

function make(
  meetingId: string | null,
  opportunityId: string | null,
  eventId: string | null,
  on: string,
  time: string | null,
  title: string,
  due: boolean,
  today: string,
): ContactMeeting {
  const day = due ? pastDay(on, today) : aheadDay(on, today);
  const clock = time12(time);
  return { meetingId, opportunityId, eventId, on, time, when: `${capital(day)}${clock ? ` ${clock}` : ""}`, title, due };
}

function capital(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Coming up's rows, each with what Held / No-show / Move act on (round 2,
// Nov 11, 2026): a meeting on the Pipeline through its OpportunityMeeting
// (found by its calendar entry), anything else through the entry itself.
// A meeting already answered — its own outcome, else its history line's,
// by the one rule (answerOf in src/lib/meeting-rule.ts) — offers Move only.
// Two statements for the whole card, scoped to the workspace.
export type UpcomingMeeting = ContactMeeting & { meeting: boolean; answered: boolean };

export async function loadUpcomingActions(
  organizationId: string,
  events: { id: string; title: string; type: string; startOn: string; startTime: string | null }[],
  today: string,
): Promise<Record<string, UpcomingMeeting>> {
  const meetingIds = events.filter((event) => nextKindOf(event.type) === "meeting").map((event) => event.id);
  const rows = meetingIds.length
    ? await prisma.opportunityMeeting.findMany({
        where: { eventId: { in: meetingIds }, opportunity: { organizationId } },
        orderBy: { createdAt: "desc" },
        select: { id: true, opportunityId: true, eventId: true, outcome: true, activityId: true },
      })
    : [];
  const lineIds = rows.map((row) => row.activityId).filter((id): id is string => Boolean(id));
  const lines = lineIds.length
    ? new Map(
        (await prisma.activity.findMany({ where: { organizationId, id: { in: lineIds } }, select: { id: true, outcome: true } })).map((line) => [
          line.id,
          line.outcome,
        ]),
      )
    : new Map<string, string | null>();
  const byEvent = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (row.eventId && !byEvent.has(row.eventId)) byEvent.set(row.eventId, row);
  const result: Record<string, UpcomingMeeting> = {};
  for (const event of events) {
    const row = byEvent.get(event.id) ?? null;
    const base = make(row?.id ?? null, row?.opportunityId ?? null, event.id, event.startOn, event.startTime, event.title, false, today);
    result[event.id] = {
      ...base,
      meeting: nextKindOf(event.type) === "meeting",
      answered: row ? answerOf(row.outcome, row.activityId ? lines.get(row.activityId) : null) !== null : false,
    };
  }
  return result;
}
