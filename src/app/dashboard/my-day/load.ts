import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OVERDUE_TYPES } from "@/lib/calendar-data";
import { goneQuietOpportunities } from "@/lib/gone-quiet";
import { healthSettings, loadContactHealth } from "@/lib/health-load";
import { isoDiff, zoneDay, zoneTime, type LeadHealth } from "@/lib/health";
import { addDaysIso, periodRange, zonedParts } from "@/lib/reports/period";
import { repNumbers, type RepNumbers } from "@/lib/reports/daily";
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
};

export type MeetingItem = {
  eventId: string;
  meetingId: string | null;
  title: string;
  on: string;
  time: string | null;
  who: string | null;
  contactId: string | null;
  past: boolean;
  done: boolean;
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
      due_ev AS (
        SELECT e."contactId" AS cid, e."startOn", e."startTime", e.type, ${meetingTypes} AS meeting
          FROM "CalendarEvent" e
          JOIN "Contact" c ON c.id = e."contactId"
         WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL AND e."contactId" IS NOT NULL
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
               (array_agg(type ORDER BY "startTime" NULLS LAST) FILTER (WHERE "startOn" = ${today}::date AND NOT meeting))[1] AS today_type
          FROM due_ev
         GROUP BY cid
      ),
      ahead AS (
        SELECT DISTINCT e."contactId" AS cid
          FROM "CalendarEvent" e
          JOIN mine m ON m.id = e."contactId"
         WHERE e."organizationId" = ${organizationId} AND e."doneAt" IS NULL AND e."startOn" > ${today}::date
      ),
      picked AS (
        (SELECT cid AS id, 'due' AS why FROM due
          WHERE late_oldest IS NOT NULL OR meeting_oldest IS NOT NULL OR today_type IS NOT NULL
          ORDER BY COALESCE(meeting_oldest, late_oldest, ${today}::date) LIMIT ${DUE_CAP})
        UNION ALL
        (SELECT m.id, 'meeting' FROM mine m
          WHERE m.status = 'MEETING_SET' AND NOT EXISTS (SELECT 1 FROM ahead a WHERE a.cid = m.id)
          ORDER BY m."lastTouchAt" NULLS FIRST LIMIT ${GROUP_CAP})
        UNION ALL
        (SELECT m.id, 'talked' FROM mine m
          WHERE m.status IN ('CONNECTED', 'INTERESTED') AND NOT EXISTS (SELECT 1 FROM ahead a WHERE a.cid = m.id)
          ORDER BY m."lastConnectAt" NULLS FIRST, m."lastTouchAt" NULLS FIRST LIMIT ${GROUP_CAP})
        UNION ALL
        (SELECT m.id, 'new' FROM mine m
          WHERE m.status = 'NOT_ACTIONED' AND m."lastTouchAt" IS NULL AND NOT EXISTS (SELECT 1 FROM ahead a WHERE a.cid = m.id)
          ORDER BY m."createdAt" DESC LIMIT ${GROUP_CAP})
        UNION ALL
        (SELECT m.id, 'trying' FROM mine m
          WHERE (m.status = 'CONTACTED' OR (m.status = 'NOT_ACTIONED' AND m."lastTouchAt" IS NOT NULL))
            AND NOT EXISTS (SELECT 1 FROM ahead a WHERE a.cid = m.id)
          ORDER BY m."lastTouchAt" NULLS FIRST LIMIT ${GROUP_CAP})
      ),
      ids AS (SELECT id, array_agg(why) AS why FROM picked GROUP BY id)
      SELECT c.id, c.name, co.name AS company, c.mobile, c.phone, c."imageUrl" AS image_url,
             c."createdAt" AS created_at, c."lastTouchAt" AS last_touch, c."lastConnectAt" AS last_connect,
             d.late_oldest, d.meeting_oldest, d.today_time, d.today_type,
             EXISTS (SELECT 1 FROM ahead a WHERE a.cid = c.id) AS ahead, ids.why
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
    prisma.activity.findMany({
      where: { organizationId, userId: rep.id, marketing: false, occurredAt: { gte: todayWindow.from, lte: now } },
      orderBy: { occurredAt: "desc" },
      take: 80,
      select: {
        id: true,
        batchId: true,
        type: true,
        outcome: true,
        body: true,
        occurredAt: true,
        contactId: true,
        companyId: true,
        contact: { select: { name: true } },
        company: { select: { name: true } },
      },
    }),
    goneQuietOpportunities(organizationId, { quietDays: settings.quietDays, limit: 300 }),
  ]);

  // Health for every candidate, in two statements.
  const health = await loadContactHealth(
    organizationId,
    candidates.map((row) => row.id),
    { settings, now },
  );

  const byId = new Map(candidates.map((row) => [row.id, row]));
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
      bookedAhead: row.ahead || one.nextText !== null,
      lastTalkDays: row.last_connect ? Math.max(0, isoDiff(today, zoneDay(row.last_connect, timeZone))) : null,
      meetingOn: isoOf(row.meeting_oldest),
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
    };
  });
  const groupCounts = new Map<string, number>();
  for (const row of candidates) for (const why of row.why) groupCounts.set(why, (groupCounts.get(why) ?? 0) + 1);
  const more = [...groupCounts.entries()].some(([why, n]) => n >= (why === "due" ? DUE_CAP : GROUP_CAP));

  // Meetings: today and the next 7 days, and any past one nobody closed out.
  const nowTime = zoneTime(now, timeZone);
  const meetingRows = meetings.map((event) => {
    const on = isoOf(event.startOn)!;
    const past = on < today || (on === today && Boolean(event.startTime) && event.startTime! <= nowTime);
    return {
      eventId: event.id,
      meetingId: null as string | null,
      title: event.title,
      on,
      time: event.startTime,
      who: event.contact ? `${event.contact.name}${event.contact.company ? ` · ${event.contact.company.name}` : ""}` : (event.company?.name ?? null),
      contactId: event.contactId,
      past,
      done: Boolean(event.doneAt),
    };
  });
  const open = meetingRows.filter((row) => !row.done).map((row) => row.eventId);
  if (open.length) {
    const linked = await prisma.opportunityMeeting.findMany({
      where: { eventId: { in: open }, opportunity: { organizationId } },
      select: { id: true, eventId: true },
    });
    const meetingOf = new Map(linked.map((row) => [row.eventId, row.id]));
    for (const row of meetingRows) row.meetingId = meetingOf.get(row.eventId) ?? null;
  }

  // Done today: one line per save.
  const seen = new Set<string>();
  const doneItems: DoneItem[] = [];
  for (const row of done) {
    const key = row.batchId ?? row.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const others = done.filter((other) => (other.batchId ?? other.id) === key).length - 1;
    const who = row.contact?.name ?? row.company?.name ?? "Someone";
    const outcome = row.outcome ? ACTIVITY_OUTCOME_LABELS[row.outcome as ActivityOutcomeValue] : null;
    doneItems.push({
      key,
      at: zoneTime(row.occurredAt, timeZone),
      type: ACTIVITY_LABELS[row.type as ActivityTypeValue] ?? row.type,
      words: outcome ?? (row.body.length > 80 ? `${row.body.slice(0, 80).trimEnd()}…` : row.body),
      who: others > 0 ? `${who} + ${others}` : who,
      contactId: row.contactId,
      companyId: row.contactId ? null : row.companyId,
    });
  }

  // The loudest account gone quiet among this rep's opportunities.
  let quietOne: { name: string; days: number } | null = null;
  if (quiet.opportunities.length) {
    const owned = await prisma.opportunity.findMany({
      where: { organizationId, id: { in: quiet.opportunities.map((row) => row.id) }, ownerId: rep.id },
      select: { id: true },
    });
    const mineQuiet = new Set(owned.map((row) => row.id));
    const top = quiet.opportunities.filter((row) => mineQuiet.has(row.id)).sort((a, b) => b.days - a.days)[0];
    if (top) quietOne = { name: shortName(top.title), days: top.days };
  }

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
