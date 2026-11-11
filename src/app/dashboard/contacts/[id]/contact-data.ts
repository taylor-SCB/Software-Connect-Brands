import { prisma } from "@/lib/prisma";
import { aheadDay, pastDay, time12, zoneDay, zoneTime } from "@/lib/health";

// What the contact page's header and Next step strip need to act on a
// meeting (BDR redesign, Nov 11, 2026): the meeting that has happened and
// nobody marked yet ("Met Nov 6 — how did it go?"), and the next one still
// to come ("Meeting Tue 10:00 AM" with Reschedule). A meeting on the
// Pipeline is an OpportunityMeeting (Held / No-show / Reschedule through
// deals/opportunity-actions.ts); a meeting only on the calendar is a
// CalendarEvent of type Meeting (Held / No-show through the calendar's
// Done box, Move through moveEvent). Three statements, all scoped to the
// workspace, whatever the person's history holds.

export type ContactMeeting = {
  // OpportunityMeeting id, when it is on the Pipeline.
  meetingId: string | null;
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
): Promise<{ due: ContactMeeting | null; next: ContactMeeting | null }> {
  const today = zoneDay(now, timeZone);
  const [meetings, events] = await Promise.all([
    prisma.opportunityMeeting.findMany({
      where: {
        outcome: null,
        opportunity: { organizationId, contacts: { some: { contactId, role: { not: "HIDDEN" } } } },
      },
      orderBy: { on: "asc" },
      take: 40,
      select: { id: true, on: true, eventId: true, activityId: true, opportunity: { select: { title: true } } },
    }),
    // Meetings on the calendar with them, open (not ticked done): the ones
    // a Pipeline meeting doesn't cover yet.
    prisma.calendarEvent.findMany({
      where: {
        organizationId,
        doneAt: null,
        type: { equals: "Meeting", mode: "insensitive" },
        OR: [{ contactId }, { attendees: { some: { id: contactId } } }],
      },
      orderBy: [{ startOn: "desc" }],
      take: 40,
      select: { id: true, title: true, startOn: true, startTime: true, activityId: true },
    }),
  ]);
  const activityIds = meetings.map((row) => row.activityId).filter((id): id is string => Boolean(id));
  const eventIds = meetings.map((row) => row.eventId).filter((id): id is string => Boolean(id));
  const [marked, linkedEvents] = await Promise.all([
    activityIds.length
      ? prisma.activity.findMany({
          where: { organizationId, id: { in: activityIds }, outcome: { in: ["HELD", "NO_SHOW"] } },
          select: { id: true },
        })
      : Promise.resolve([]),
    eventIds.length
      ? prisma.calendarEvent.findMany({
          where: { organizationId, id: { in: eventIds } },
          select: { id: true, startOn: true, startTime: true, doneAt: true },
        })
      : Promise.resolve([]),
  ]);
  const markedIds = new Set(marked.map((row) => row.id));
  const eventById = new Map(linkedEvents.map((row) => [row.id, row]));

  const open: ContactMeeting[] = [];
  const covered = new Set<string>();
  for (const row of meetings) {
    if (row.activityId && markedIds.has(row.activityId)) continue;
    const event = row.eventId ? eventById.get(row.eventId) : undefined;
    if (row.eventId) covered.add(row.eventId);
    // Ticked done on the calendar without an outcome: it happened.
    if (event?.doneAt) continue;
    const on = event ? event.startOn.toISOString().slice(0, 10) : zoneDay(row.on, timeZone);
    const time = event ? event.startTime : zoneTime(row.on, timeZone);
    open.push(make(row.id, row.eventId, on, time, row.opportunity.title, row.on.getTime() <= now.getTime(), today));
  }
  for (const event of events) {
    if (covered.has(event.id)) continue;
    const on = event.startOn.toISOString().slice(0, 10);
    // A calendar meeting is due once its day has come.
    const due = on < today || (on === today && Boolean(event.startTime) && (event.startTime ?? "") <= zoneTime(now, timeZone));
    open.push(make(null, event.id, on, event.startTime, event.title, due, today));
  }

  const dueOnes = open.filter((row) => row.due).sort((a, b) => (a.on + (a.time ?? "")).localeCompare(b.on + (b.time ?? "")));
  const ahead = open.filter((row) => !row.due).sort((a, b) => (a.on + (a.time ?? "")).localeCompare(b.on + (b.time ?? "")));
  return { due: dueOnes[dueOnes.length - 1] ?? null, next: ahead[0] ?? null };
}

function make(meetingId: string | null, eventId: string | null, on: string, time: string | null, title: string, due: boolean, today: string): ContactMeeting {
  const day = due ? pastDay(on, today) : aheadDay(on, today);
  const clock = time12(time);
  return { meetingId, eventId, on, time, when: `${capital(day)}${clock ? ` ${clock}` : ""}`, title, due };
}

function capital(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
