import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OVERDUE_TYPES } from "@/lib/calendar-data";
import { goneQuietOpportunities } from "@/lib/gone-quiet";
import { waitingMeetings, type Waiting } from "@/lib/meetings";
import { recentSaves } from "@/lib/recent-saves";
import { healthSettings, loadContactHealth } from "@/lib/health-load";
import { isoDiff, zoneDay, zoneTime, type LeadHealth } from "@/lib/health";
import { addDaysIso, periodRange, zonedParts } from "@/lib/reports/period";
import { repNumbers, type RepNumbers } from "@/lib/reports/daily";
import { zonedMoment } from "@/lib/calendar-auto";
import { greeting, rankUpNext, type UpNextCandidate, type UpNextCategory } from "@/lib/up-next";
import { ACTIVITY_OUTCOME_LABELS, ACTIVITY_LABELS, type ActivityOutcomeValue, type ActivityTypeValue } from "@/lib/constants";

// My day's data (BDR redesign, Nov 11, 2026), for one rep: the viewer, or
// a teammate an Owner opened from Team today (read-only). Every statement
// is scoped to the workspace and batched; health comes from the same
// loader the lists use (two statements for the whole Up next).
//
// Up next candidates, each group capped so a rep with a huge book still
// loads in one go: everything with an open follow-up due today or late
// (theirs, or on their people); their people at Meeting Set; Connected or
// Interested; never touched; still trying. Then health decides, and
// rankUpNext (src/lib/up-next.ts) puts them in the plan's order.

const GROUP_CAP = 40;
const DUE_CAP = 120;
const OPEN_STATUSES = ["NOT_ACTIONED", "CONTACTED", "CONNECTED", "INTERESTED", "MEETING_SET"];

export type UpNextItem = {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  imageUrl: string | null;
  category: UpNextCategory;
  reason: string;
  park: boolean;
  health: LeadHealth;
  // The tile the row is about (the meeting waiting, else the one booked,
  // else their latest), handed to the log and booking sheets.
  opportunityId: string | null;
  // The entry due (late or today) for Done / Reschedule / Delete (Planner
  // AI, Nov 12, 2026); null when the row has nothing scheduled.
  entry: UpNextEntry | null;
};

export type UpNextEntry = {
  id: string;
  title: string;
  type: string;
  notes: string;
  startOn: string;
  startTime: string | null;
  delegatedBy: string | null;
};

export type MeetingItem = {
  // The calendar entry, or the booked meeting when it has no entry.
  eventId: string;
  meetingId: string | null;
  opportunityId: string | null;
  title: string;
  on: string;
  time: string | null;
  who: string | null;
  contactId: string | null;
  past: boolean;
  done: boolean;
  // Waiting for Held / No-show, by the one meeting rule.
  waiting: boolean;
};

export type DoneItem = { key: string; at: string; type: string; words: string; who: string; contactId: string | null; companyId: string | null };

export type MyDay = {
  rep: { id: string; name: string };
  today: string;
  greeting: string;
  numbers: RepNumbers;
  goals: { tries: number | null; talks: number | null; booked: number | null };
  upNext: UpNextItem[];
  // A group came back full, so there may be more than the list shows.
  more: boolean;
  unowned: { count: number; ids: string[] };
  meetings: MeetingItem[];
  done: DoneItem[];
};

type CandidateRow = {
  id: string;
  name: string;
  company: string | null;
  mobile: string | null;
  phone: string | null;
  image_url: string | null;
  created_at: Date;
  last_touch: Date | null;
  last_connect: Date | null;
  late_oldest: Date | null;
  meeting_oldest: Date | null;
  today_time: string | null;
  today_type: string | null;
  due_eid: string | null;
  ahead: boolean;
  why: string[];
};

function isoOf(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

function shortName(title: string) {
  const words = title.trim().split(/\s+/);
  if (title.length <= 16) return title.trim();
  return words[0].length >= 4 ? words[0] : words.slice(0, 2).join(" ");
}

export async function loadMyDay(organizationId: string, rep: { id: string; name: string }, now = new Date()): Promise<MyDay> {
  const settings = await healthSettings(organizationId);
  const timeZone = settings.timeZone;
  const today = zoneDay(now, timeZone);
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const todayWindow = periodRange("today", timeZone, now);
  const meetingFrom = new Date(`${addDaysIso(today, -30)}T00:00:00.000Z`);
  const meetingTo = new Date(`${addDaysIso(today, 7)}T00:00:00.000Z`);
  const meetingTypes = Prisma.sql`lower(e.type) = 'meeting'`;
  const otherTypes = OVERDUE_TYPES.filter((type) => type.toLowerCase() !== "meeting");

  const [candidates, numbers, org, unownedCount, unownedIds, meetings, done, quiet] = await Promise.all([
    prisma.$queryRaw<CandidateRow[]>`
      WITH mine AS (
        SELECT c.id, c.status::text AS status, c."lastTouchAt", c."lastConnectAt", c."createdAt"
          FROM "Contact" c
         WHERE c."organizationId" = ${organizationId} AND c."ownerId" = ${rep.id}
           AND c.status::text = ANY(${OPEN_STATUSES})
      ),
      -- Everyone on an entry: its person and everyone also expected
      -- (audit fix, Nov 12, 2026: a follow-up from a call logged on three
      -- people is one entry, the first person on it and the other two as
      -- attendees, and only the first was due).
      on_ev AS (
        SELECT e.id AS eid, e."contactId" AS cid FROM "CalendarEvent" e
         WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL AND e."contactId" IS NOT NULL
        UNION
        SELECT e.id, ea."B" FROM "CalendarEvent" e JOIN "_EventAttendees" ea ON ea."A" = e.id
         WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL
      ),
      due_ev AS (
        SELECT o.cid, e.id AS eid, e."startOn", e."startTime", e.type, ${meetingTypes} AS meeting
          FROM "CalendarEvent" e
          JOIN on_ev o ON o.eid = e.id
          JOIN "Contact" c ON c.id = o.cid AND c."organizationId" = ${organizationId}
         WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL
           AND e."startOn" <= ${today}::date AND (e."endOn" IS NULL OR e."endOn" <= ${today}::date)
           AND e.type = ANY(${OVERDUE_TYPES})
           AND (e."ownerId" = ${rep.id} OR c."ownerId" = ${rep.id})
           AND c.status::text NOT IN ('WON', 'LOST', 'ARCHIVED', 'NOT_INTERESTED')
      ),
      due AS (
        SELECT cid,
               MIN("startOn") FILTER (WHERE "startOn" < ${today}::date AND NOT meeting) AS late_oldest,
               MIN("startOn") FILTER (WHERE "startOn" < ${today}::date AND meeting) AS meeting_oldest,
               MIN("startTime") FILTER (WHERE "startOn" = ${today}::date AND NOT meeting) AS today_time,
               (array_agg(type ORDER BY "startTime" NULLS LAST) FILTER (WHERE "startOn" = ${today}::date AND NOT meeting))[1] AS today_type,
               -- The entry the row's Done / Reschedule / Delete act on (Planner
               -- AI, Nov 12, 2026): the oldest one due, not a meeting.
               (array_agg(eid ORDER BY "startOn", "startTime" NULLS LAST, eid) FILTER (WHERE NOT meeting))[1] AS due_eid
          FROM due_ev
         GROUP BY cid
      ),
      -- Read with NOT IN / IN, never NOT EXISTS (perf fix, Nov 11, 2026): the
      -- planner guesses this at one row, and a NOT EXISTS against it became a
      -- nested-loop anti-join rescanning it per contact (3.8 s at 200,000
      -- contacts; a hashed subplan is 0.13 s). cid comes off a join to mine,
      -- so it is never NULL and NOT IN means exactly what NOT EXISTS did.
      ahead AS (
        SELECT DISTINCT o.cid
          FROM "CalendarEvent" e
          JOIN on_ev o ON o.eid = e.id
          JOIN mine m ON m.id = o.cid
         WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL AND e."startOn" > ${today}::date
      ),
      picked AS (
        (SELECT cid AS id, 'due' AS why FROM due
          WHERE late_oldest IS NOT NULL OR meeting_oldest IS NOT NULL OR today_type IS NOT NULL
          ORDER BY COALESCE(meeting_oldest, late_oldest, ${today}::date) LIMIT ${DUE_CAP})
        UNION ALL
        (SELECT m.id, 'meeting' FROM mine m
          WHERE m.status = 'MEETING_SET' AND m.id NOT IN (SELECT cid FROM ahead WHERE cid IS NOT NULL)
          ORDER BY m."lastTouchAt" NULLS FIRST LIMIT ${GROUP_CAP})
        UNION ALL
        (SELECT m.id, 'talked' FROM mine m
          WHERE m.status IN ('CONNECTED', 'INTERESTED') AND m.id NOT IN (SELECT cid FROM ahead WHERE cid IS NOT NULL)
          ORDER BY m."lastConnectAt" NULLS FIRST, m."lastTouchAt" NULLS FIRST LIMIT ${GROUP_CAP})
        UNION ALL
        (SELECT m.id, 'new' FROM mine m
          WHERE m.status = 'NOT_ACTIONED' AND m."lastTouchAt" IS NULL AND m.id NOT IN (SELECT cid FROM ahead WHERE cid IS NOT NULL)
          ORDER BY m."createdAt" DESC LIMIT ${GROUP_CAP})
        UNION ALL
        (SELECT m.id, 'trying' FROM mine m
          WHERE (m.status = 'CONTACTED' OR (m.status = 'NOT_ACTIONED' AND m."lastTouchAt" IS NOT NULL))
            AND m.id NOT IN (SELECT cid FROM ahead WHERE cid IS NOT NULL)
          ORDER BY m."lastTouchAt" NULLS FIRST LIMIT ${GROUP_CAP})
      ),
      ids AS (SELECT id, array_agg(why) AS why FROM picked GROUP BY id)
      SELECT c.id, c.name, co.name AS company, c.mobile, c.phone, c."imageUrl" AS image_url,
             c."createdAt" AS created_at, c."lastTouchAt" AS last_touch, c."lastConnectAt" AS last_connect,
             d.late_oldest, d.meeting_oldest, d.today_time, d.today_type, d.due_eid,
             c.id IN (SELECT cid FROM ahead WHERE cid IS NOT NULL) AS ahead, ids.why
        FROM ids
        JOIN "Contact" c ON c.id = ids.id AND c."organizationId" = ${organizationId}
        LEFT JOIN "Company" co ON co.id = c."companyId"
        LEFT JOIN due d ON d.cid = c.id`,
    repNumbers(organizationId, [rep.id], timeZone, now),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { weeklyTryGoal: true, weeklyTalkGoal: true, weeklyMeetingGoal: true },
    }),
    prisma.contact.count({ where: { organizationId, ownerId: null, status: "NOT_ACTIONED", lastTouchAt: null } }),
    prisma.contact.findMany({
      where: { organizationId, ownerId: null, status: "NOT_ACTIONED", lastTouchAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 10,
      select: { id: true },
    }),
    prisma.calendarEvent.findMany({
      where: {
        organizationId,
        ownerId: rep.id,
        type: { equals: "Meeting", mode: "insensitive" },
        startOn: { gte: meetingFrom, lte: meetingTo },
        OR: [{ startOn: { gte: todayDate } }, { doneAt: null }],
      },
      orderBy: [{ startOn: "asc" }, { startTime: { sort: "asc", nulls: "last" } }],
      take: 40,
      select: {
        id: true,
        title: true,
        startOn: true,
        startTime: true,
        doneAt: true,
        contactId: true,
        contact: { select: { name: true, company: { select: { name: true } } } },
        company: { select: { name: true } },
      },
    }),
    // Saves first, then their rows (audit fix, Nov 12, 2026): one call on
    // 100 people no longer fills the card and hides the morning's saves.
    recentSaves(organizationId, { userId: rep.id, from: todayWindow.from, to: now, limit: 40 }),
    // The rep's own, in the statement (final audit, Nov 11, 2026): kept from
    // the workspace's 300 quietest, a rep's own dropped out past 300. Oldest
    // touch first, so the first row is the loudest.
    goneQuietOpportunities(organizationId, { quietDays: settings.quietDays, ownerId: rep.id, limit: 1 }),
  ]);

  // Health for every candidate, in two statements, and which meeting each
  // is waiting on by the one rule (src/lib/meeting-rule.ts), in three.
  const candidateIds = candidates.map((row) => row.id);
  const [health, waiting] = await Promise.all([
    loadContactHealth(organizationId, candidateIds, { settings, now }),
    waitingMeetings(organizationId, { contactIds: candidateIds }, { now, timeZone }),
  ]);

  const byId = new Map(candidates.map((row) => [row.id, row]));
  const dueIds = [...new Set(candidates.map((row) => row.due_eid).filter((id): id is string => Boolean(id)))];
  const dueEntries = dueIds.length
    ? await prisma.calendarEvent.findMany({
        // Only entries on this rep's own calendar get the buttons: a
        // teammate's follow-up on one of their people stays the teammate's.
        where: { organizationId, id: { in: dueIds }, ownerId: rep.id },
        select: { id: true, title: true, type: true, notes: true, startOn: true, startTime: true, ownerId: true, createdById: true, createdBy: { select: { name: true } } },
      })
    : [];
  const entryOf = new Map<string, UpNextEntry>(
    dueEntries.map((event) => [
      event.id,
      {
        id: event.id,
        title: event.title,
        type: event.type,
        notes: event.notes,
        startOn: event.startOn.toISOString().slice(0, 10),
        startTime: event.startTime,
        // Delegated: on this rep's calendar, put there by someone else.
        delegatedBy: event.ownerId === rep.id && event.createdById && event.createdById !== rep.id ? (event.createdBy?.name ?? "a teammate") : null,
      },
    ]),
  );
  const input: UpNextCandidate[] = [];
  for (const row of candidates) {
    const one = health.get(row.id);
    if (!one) continue;
    const late = isoOf(row.late_oldest);
    input.push({
      id: row.id,
      health: one,
      lateDays: late ? Math.max(1, isoDiff(today, late)) : null,
      dueToday: row.today_type ? { time: row.today_time, kind: kindWord(row.today_type) } : null,
      // Something booked on a LATER day (audit fix, Nov 12, 2026: health's
      // nextText also counts today, which took a row due today off the list).
      bookedAhead: row.ahead || Boolean(waiting.get(row.id)?.ahead),
      lastTalkDays: row.last_connect ? Math.max(0, isoDiff(today, zoneDay(row.last_connect, timeZone))) : null,
      // A meeting gone by that nobody answered, by the one rule (a bare
      // calendar entry with no booked meeting behind it is a follow-up).
      meetingOn: waiting.get(row.id)?.due?.day ?? null,
      lastTouchAt: row.last_touch ? row.last_touch.getTime() : null,
      createdAt: row.created_at.getTime(),
    });
  }
  const ranked = rankUpNext(input);
  const upNext: UpNextItem[] = ranked.map((entry) => {
    const row = byId.get(entry.id)!;
    return {
      id: entry.id,
      name: row.name,
      company: row.company,
      phone: row.mobile || row.phone || null,
      imageUrl: row.image_url,
      category: entry.category,
      reason: entry.reason,
      park: entry.park,
      health: health.get(entry.id)!,
      opportunityId: tileOf(waiting.get(entry.id)),
      entry: (entry.category === "late" || entry.category === "today") && row.due_eid ? (entryOf.get(row.due_eid) ?? null) : null,
    };
  });
  const groupCounts = new Map<string, number>();
  for (const row of candidates) for (const why of row.why) groupCounts.set(why, (groupCounts.get(why) ?? 0) + 1);
  const more = [...groupCounts.entries()].some(([why, n]) => n >= (why === "due" ? DUE_CAP : GROUP_CAP));

  // Meetings: today and the next 7 days, and any past one still waiting
  // for an answer. Booked meetings (OpportunityMeeting) on this rep's tiles
  // or booked by them, with "waiting" from the one meeting rule; then any
  // Meeting entry on their calendar with no booked meeting behind it
  // (Held / No-show then ticks the entry).
  const nowTime = zoneTime(now, timeZone);
  // Each kind is read in two parts (audit, Nov 11, 2026): what is still to
  // come (from the start of today's window), and what has gone by with no
  // answer yet, newest first. One list from 30 days back, oldest first and
  // capped at 60, filled up with last month's answered meetings for a rep
  // who books a lot, and this week's never loaded.
  const bookedSelect = {
    id: true,
    on: true,
    eventId: true,
    opportunityId: true,
    opportunity: { select: { title: true, contacts: { where: { role: "PRIMARY" as const }, take: 1, select: { contact: { select: { id: true, name: true, company: { select: { name: true } } } } } } } },
  };
  const bookedUntil = new Date(meetingTo.getTime() + 86_400_000);
  // A day's margin, so a row stamped at midnight UTC (the calendar form,
  // before the audit) for today still counts as today's.
  const bookedSplit = new Date(todayWindow.from.getTime() - 86_400_000);
  const ofTiles = { opportunity: { organizationId, ownerId: rep.id } };
  const ofBooker = { bookedById: rep.id, opportunity: { organizationId, NOT: { ownerId: rep.id } } };
  const [bookedAhead, bookedGone, byAhead, byGone] = await Promise.all([
    prisma.opportunityMeeting.findMany({ where: { ...ofTiles, on: { gte: bookedSplit, lte: bookedUntil } }, orderBy: { on: "asc" }, take: 60, select: bookedSelect }),
    prisma.opportunityMeeting.findMany({ where: { ...ofTiles, outcome: null, on: { gte: meetingFrom, lt: bookedSplit } }, orderBy: { on: "desc" }, take: 30, select: bookedSelect }),
    prisma.opportunityMeeting.findMany({ where: { ...ofBooker, on: { gte: bookedSplit, lte: bookedUntil } }, orderBy: { on: "asc" }, take: 60, select: bookedSelect }),
    prisma.opportunityMeeting.findMany({ where: { ...ofBooker, outcome: null, on: { gte: meetingFrom, lt: bookedSplit } }, orderBy: { on: "desc" }, take: 30, select: bookedSelect }),
  ]);
  const booked = [...bookedGone, ...bookedAhead];
  const bookedBy = [...byGone, ...byAhead];
  const allBooked = [...booked, ...bookedBy];
  const tiles = await waitingMeetings(organizationId, { opportunityIds: [...new Set(allBooked.map((row) => row.opportunityId))] }, { now, timeZone });
  const eventOf = new Map<string, { id: string; startOn: Date; startTime: string | null; title: string; doneAt: Date | null }>(meetings.map((event) => [event.id, event]));
  // A booked meeting's own calendar entry when it isn't one of this rep's
  // (a teammate's calendar, or ticked and gone by): its day and time are
  // the meeting's, not a day worked out from the row (audit, Nov 11, 2026).
  const missing = [...new Set(allBooked.map((row) => row.eventId).filter((id): id is string => Boolean(id) && !eventOf.has(id!)))];
  if (missing.length) {
    const extra = await prisma.calendarEvent.findMany({
      where: { organizationId, id: { in: missing } },
      select: { id: true, startOn: true, startTime: true, title: true, doneAt: true },
    });
    for (const event of extra) eventOf.set(event.id, event);
  }
  const meetingRows: MeetingItem[] = [];
  const seenEvents = new Set<string>();
  for (const row of allBooked) {
    const event = row.eventId ? eventOf.get(row.eventId) : undefined;
    if (row.eventId) seenEvents.add(row.eventId);
    const on = event ? isoOf(event.startOn)! : zoneDay(row.on, timeZone);
    const time = event ? event.startTime : null;
    const tile = tiles.get(row.opportunityId);
    // When it happens: the entry's day and time in the workspace's clock
    // (noon when it has no time), else the row's moment. A row written by
    // the calendar form before the audit holds midnight UTC, the evening
    // before in the US.
    const at = event ? zonedMoment(on, event.startTime ?? "12:00", timeZone).getTime() : row.on.getTime();
    const isWaiting = tile?.toAnswer?.id === row.id && at <= now.getTime();
    const answered = Boolean(tile && !isWaiting && at <= now.getTime());
    const past = on < today || (on === today && (time ? time <= nowTime : at <= now.getTime()));
    // Gone by and answered (or ticked): it's in the history now, off the card
    // unless it was today.
    if (past && !isWaiting && on < today) continue;
    const person = row.opportunity.contacts[0]?.contact;
    meetingRows.push({
      eventId: row.eventId ?? row.id,
      meetingId: row.id,
      opportunityId: row.opportunityId,
      title: event?.title ?? row.opportunity.title,
      on,
      time,
      who: person ? `${person.name}${person.company ? ` · ${person.company.name}` : ""}` : null,
      contactId: person?.id ?? null,
      past,
      done: past && !isWaiting && (answered || Boolean(event?.doneAt)),
      waiting: isWaiting,
    });
  }
  for (const event of meetings) {
    if (seenEvents.has(event.id)) continue;
    const on = isoOf(event.startOn)!;
    const past = on < today || (on === today && Boolean(event.startTime) && event.startTime! <= nowTime);
    meetingRows.push({
      eventId: event.id,
      meetingId: null,
      opportunityId: null,
      title: event.title,
      on,
      time: event.startTime,
      who: event.contact ? `${event.contact.name}${event.contact.company ? ` · ${event.contact.company.name}` : ""}` : (event.company?.name ?? null),
      contactId: event.contactId,
      past,
      done: Boolean(event.doneAt),
      waiting: past && !event.doneAt,
    });
  }
  meetingRows.sort((a, b) => a.on.localeCompare(b.on) || (a.time ?? "99:99").localeCompare(b.time ?? "99:99"));

  // Done today: one line per save, with the save's true head count.
  const doneItems: DoneItem[] = done.map((save) => {
    const row = save.first;
    const who = row.contact?.name ?? row.company?.name ?? "Someone";
    const others = Math.max(0, save.peopleCount - 1);
    const outcome = row.outcome ? ACTIVITY_OUTCOME_LABELS[row.outcome as ActivityOutcomeValue] : null;
    return {
      key: save.key,
      at: zoneTime(row.occurredAt, timeZone),
      type: ACTIVITY_LABELS[row.type as ActivityTypeValue] ?? row.type,
      words: outcome ?? (row.body.length > 80 ? `${row.body.slice(0, 80).trimEnd()}…` : row.body),
      who: others > 0 ? `${who} + ${others}` : who,
      contactId: row.contactId,
      companyId: row.contactId ? null : row.companyId,
    };
  });

  // The loudest account gone quiet among this rep's opportunities.
  const top = quiet.opportunities[0];
  const quietOne: { name: string; days: number } | null = top ? { name: shortName(top.title), days: top.days } : null;

  const late = upNext.filter((row) => row.category === "late").length;
  const toCall = upNext.filter((row) => row.category !== "late" && row.category !== "meeting").length;
  const repNums = numbers.get(rep.id)!;
  return {
    rep,
    today,
    greeting: greeting({
      hour: zonedParts(now, timeZone).hour,
      firstName: rep.name.trim().split(/\s+/)[0] || "there",
      late,
      toCall,
      quiet: quietOne,
    }),
    numbers: repNums,
    goals: { tries: org?.weeklyTryGoal ?? null, talks: org?.weeklyTalkGoal ?? null, booked: org?.weeklyMeetingGoal ?? null },
    upNext,
    more,
    unowned: { count: unownedCount, ids: unownedIds.map((row) => row.id) },
    meetings: meetingRows,
    done: doneItems,
  };
}

// A calendar entry's type as the reason line says it.
function kindWord(type: string) {
  const t = type.trim().toLowerCase();
  if (t === "call") return "call";
  if (t === "text") return "text";
  if (t === "email") return "email";
  if (t.includes("quote")) return "quote follow-up";
  if (t.includes("contract")) return "contract follow-up";
  return "follow-up";
}

// The tile a row is about: the meeting waiting for an answer, else the one
// booked ahead, else their latest.
function tileOf(waiting: Waiting | undefined) {
  return waiting?.toAnswer?.opportunityId ?? waiting?.ahead?.opportunityId ?? waiting?.last?.opportunityId ?? null;
}
