import { prisma } from "@/lib/prisma";
import { goneQuietOpportunities } from "@/lib/gone-quiet";
import { OVERDUE_TYPES } from "@/lib/calendar-data";
import { computeQuoteTotals } from "@/lib/quote-math";
import { loadTeam, nameOf, num, type Headline, type ReportParams, type SummaryTable } from "@/lib/reports/common";
import { addDaysIso, daysBetweenIso, periodRange } from "@/lib/reports/period";
import { Prisma } from "@/generated/prisma/client";
import { healthSettings, loadContactHealth } from "@/lib/health-load";

// Daily Rundown (Nov 10, 2026): the morning list, in STRATEGY.md's order —
// money first, then what is on today, what slipped, what went quiet, and
// what went out and came in yesterday. Always today and yesterday in the
// workspace's zone, whatever period the bar holds; the rep picker narrows
// it to one teammate's calendar, follow-ups, opportunities, paperwork and
// new contacts.

const LIST = 8;

export type DailyReport = {
  kind: "daily";
  today: string;
  yesterday: string;
  // count is every entry today; open is the ones not yet done. items lists
  // the open ones first, then the done ones (UX review, Nov 10, 2026: by
  // start time alone a morning of ticked-off calls filled the card and
  // pushed the afternoon's open entries behind See all).
  // Round 2 (BDR redesign): every row names its person (contactId, their
  // mobile or phone for Call) or its company; done entries are also listed
  // on their own (doneItems) for the collapsed "Done today".
  calendar: { count: number; open: number; items: RundownEntry[]; doneItems: RundownEntry[] };
  overdue: { count: number; items: (RundownPerson & { id: string; title: string; type: string; on: string; days: number; owner: string; who: string | null })[] };
  // Gone quiet names the Primary POC, with the company under it.
  quiet: { count: number; quietDays: number; items: { id: string; title: string; days: number; owner: string; person: { id: string; name: string; phone: string | null } | null; company: string | null }[] };
  payments: { cents: number; count: number; previousCents: number; items: { customer: string; cents: number; method: string | null }[] };
  quotes: { count: number; cents: number; items: { id: string; number: number; title: string; customer: string; cents: number }[] };
  contracts: { count: number; items: { id: string; number: number; title: string; customer: string }[] };
  contacts: { count: number; previous: number; items: { id: string; name: string; company: string | null }[] };
  headlines: Headline[];
  table: SummaryTable;
};

export type RundownPerson = { contactId: string | null; companyId: string | null; phone: string | null; company: string | null };
export type RundownEntry = RundownPerson & { id: string; title: string; type: string; time: string | null; owner: string; who: string | null; done: boolean };

type EventPeople = {
  contact: { id: string; name: string; mobile: string | null; phone: string | null; company: { name: string } | null } | null;
  company: { id: string; name: string } | null;
};
function personOf(event: EventPeople): RundownPerson {
  return {
    contactId: event.contact?.id ?? null,
    companyId: event.contact ? null : (event.company?.id ?? null),
    phone: event.contact ? event.contact.mobile || event.contact.phone || null : null,
    company: event.contact?.company?.name ?? null,
  };
}

export async function loadDaily(params: ReportParams): Promise<DailyReport> {
  const { organizationId, repId, timeZone, now } = params;
  const yesterdayRange = periodRange("yesterday", timeZone, now);
  const today = yesterdayRange.today;
  const yesterday = yesterdayRange.fromIso;
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const owner = repId ? { ownerId: repId } : {};

  const calendarWhere: Prisma.CalendarEventWhereInput = {
    organizationId,
    ...owner,
    startOn: { lte: todayDate },
    OR: [{ endOn: null, startOn: todayDate }, { endOn: { gte: todayDate } }],
  };
  const overdueWhere: Prisma.CalendarEventWhereInput = {
    organizationId,
    ...owner,
    doneAt: null,
    type: { in: OVERDUE_TYPES },
    startOn: { lt: todayDate },
    OR: [{ endOn: null }, { endOn: { lt: todayDate } }],
  };
  const yesterdayWindow = { gte: yesterdayRange.from, lt: yesterdayRange.to };

  const calendarOrder: Prisma.CalendarEventOrderByWithRelationInput[] = [{ startTime: { sort: "asc", nulls: "last" } }, { title: "asc" }];
  const peopleSelect = {
    contact: { select: { id: true, name: true, mobile: true, phone: true, company: { select: { name: true } } } },
    company: { select: { id: true, name: true } },
  } as const;
  const calendarSelect = { id: true, title: true, type: true, startTime: true, endTime: true, ownerId: true, doneAt: true, ...peopleSelect } as const;
  const [team, calendarCount, calendarOpenCount, calendarOpen, calendarDone, overdueCount, overdue, quiet, payments, quotes, contracts, contactCounts, contacts] = await Promise.all([
    loadTeam(organizationId),
    prisma.calendarEvent.count({ where: calendarWhere }),
    prisma.calendarEvent.count({ where: { ...calendarWhere, doneAt: null } }),
    prisma.calendarEvent.findMany({ where: { ...calendarWhere, doneAt: null }, orderBy: calendarOrder, take: LIST, select: calendarSelect }),
    prisma.calendarEvent.findMany({ where: { ...calendarWhere, doneAt: { not: null } }, orderBy: calendarOrder, take: LIST, select: calendarSelect }),
    prisma.calendarEvent.count({ where: overdueWhere }),
    prisma.calendarEvent.findMany({
      where: overdueWhere,
      orderBy: [{ startOn: "asc" }, { startTime: "asc" }],
      take: LIST,
      select: { id: true, title: true, type: true, startOn: true, ownerId: true, ...peopleSelect },
    }),
    quietFor(organizationId, repId),
    prisma.$queryRaw<{ day: string; customer: string; cents: number; method: string | null }[]>`
      SELECT to_char(p."paidOn", 'YYYY-MM-DD') AS day, COALESCE(co.name, ct.name) AS customer, p."amountCents" AS cents, p.method
        FROM "Payment" p
        JOIN "ContractPayment" cp ON cp.id = p."contractPaymentId"
        JOIN "Contract" c ON c.id = cp."contractId"
        LEFT JOIN "Deal" d ON d.id = c."dealId"
        LEFT JOIN "Company" co ON co.id = c."companyId"
        LEFT JOIN "Contact" ct ON ct.id = c."contactId"
       WHERE p."organizationId" = ${organizationId} AND c.payable = false
         AND p."paidOn" >= ${addDaysIso(yesterday, -1)}::date AND p."paidOn" < ${today}::date
         ${repId ? Prisma.sql`AND d."ownerId" = ${repId}` : Prisma.empty}
       ORDER BY p."amountCents" DESC`,
    prisma.quote.findMany({
      where: { organizationId, sentAt: yesterdayWindow, ...(repId ? { deal: { ownerId: repId } } : {}) },
      orderBy: { sentAt: "asc" },
      take: 200,
      select: {
        id: true,
        number: true,
        title: true,
        discountCents: true,
        discountPercent: true,
        contact: { select: { name: true, company: { select: { name: true } } } },
        lineItems: { select: { quantity: true, unitPriceCents: true, discountCents: true, tag: true } },
      },
    }),
    prisma.contract.findMany({
      where: { organizationId, payable: false, sentAt: yesterdayWindow, ...(repId ? { deal: { ownerId: repId } } : {}) },
      orderBy: { sentAt: "asc" },
      take: 200,
      select: { id: true, number: true, title: true, company: { select: { name: true } }, contact: { select: { name: true } } },
    }),
    prisma.$queryRaw<{ cur: number; prev: number }[]>`
      SELECT COUNT(*) FILTER (WHERE "createdAt" >= ${yesterdayRange.from})::int AS cur,
             COUNT(*) FILTER (WHERE "createdAt" < ${yesterdayRange.from})::int AS prev
        FROM "Contact"
       WHERE "organizationId" = ${organizationId}
         AND "createdAt" >= ${yesterdayRange.previous.from} AND "createdAt" < ${yesterdayRange.to}
         ${repId ? Prisma.sql`AND "createdById" = ${repId}` : Prisma.empty}`,
    prisma.contact.findMany({
      where: { organizationId, createdAt: yesterdayWindow, ...(repId ? { createdById: repId } : {}) },
      orderBy: { createdAt: "asc" },
      take: LIST,
      select: { id: true, name: true, company: { select: { name: true } } },
    }),
  ]);

  const calendar = [...calendarOpen, ...calendarDone].slice(0, LIST);
  const entry = (event: (typeof calendarOpen)[number]): RundownEntry => ({
    id: event.id,
    title: event.title,
    type: event.type,
    time: event.startTime ? (event.endTime ? `${event.startTime}–${event.endTime}` : event.startTime) : null,
    owner: nameOf(team, event.ownerId),
    who: event.contact?.name ?? event.company?.name ?? null,
    done: Boolean(event.doneAt),
    ...personOf(event),
  });
  const paidYesterday = payments.filter((row) => row.day === yesterday);
  const paidBefore = payments.filter((row) => row.day !== yesterday);
  const quoteRows = quotes.map((quote) => ({
    id: quote.id,
    number: quote.number,
    title: quote.title,
    customer: quote.contact.company?.name ?? quote.contact.name,
    cents: computeQuoteTotals(quote.lineItems, quote).totalCents,
  }));

  const report: Omit<DailyReport, "headlines" | "table"> = {
    kind: "daily",
    today,
    yesterday,
    calendar: {
      count: calendarCount,
      open: calendarOpenCount,
      items: calendar.map(entry),
      doneItems: calendarDone.map(entry),
    },
    overdue: {
      count: overdueCount,
      items: overdue.map((event) => {
        const on = event.startOn.toISOString().slice(0, 10);
        return {
          id: event.id,
          title: event.title,
          type: event.type,
          on,
          days: daysBetweenIso(on, today),
          owner: nameOf(team, event.ownerId),
          who: event.contact?.name ?? event.company?.name ?? null,
          ...personOf(event),
        };
      }),
    },
    quiet: {
      count: quiet.count,
      quietDays: quiet.quietDays,
      items: quiet.items.map(({ ownerId, ...item }) => ({ ...item, owner: nameOf(team, ownerId) })),
    },
    payments: {
      cents: paidYesterday.reduce((sum, row) => sum + num(row.cents), 0),
      count: paidYesterday.length,
      previousCents: paidBefore.reduce((sum, row) => sum + num(row.cents), 0),
      items: paidYesterday.slice(0, LIST).map((row) => ({ customer: row.customer, cents: num(row.cents), method: row.method })),
    },
    quotes: { count: quoteRows.length, cents: quoteRows.reduce((sum, row) => sum + row.cents, 0), items: quoteRows.slice(0, LIST) },
    contracts: {
      count: contracts.length,
      items: contracts.slice(0, LIST).map((contract) => ({
        id: contract.id,
        number: contract.number,
        title: contract.title,
        customer: contract.company?.name ?? contract.contact.name,
      })),
    },
    contacts: {
      count: contactCounts[0]?.cur ?? 0,
      previous: contactCounts[0]?.prev ?? 0,
      items: contacts.map((contact) => ({ id: contact.id, name: contact.name, company: contact.company?.name ?? null })),
    },
  };

  const headlines: Headline[] = [
    {
      id: "calendar",
      label: "On today",
      value: report.calendar.open,
      format: "count",
      hint: report.calendar.count > report.calendar.open ? `Still open · ${report.calendar.count - report.calendar.open} already done` : "Calendar entries",
    },
    { id: "overdue", label: "Overdue follow-ups", value: report.overdue.count, format: "count", goodWhenUp: false },
    { id: "quiet", label: "Gone quiet", value: report.quiet.count, format: "count", goodWhenUp: false, hint: `No touch in ${report.quiet.quietDays}+ days` },
    { id: "paid", label: "Paid yesterday", value: report.payments.cents, previous: report.payments.previousCents, format: "money", hint: `${report.payments.count} ${report.payments.count === 1 ? "payment" : "payments"}` },
    { id: "quotes", label: "Quotes sent yesterday", value: report.quotes.count, format: "count", hint: `worth ${Math.round(report.quotes.cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}` },
    { id: "contacts", label: "New contacts yesterday", value: report.contacts.count, previous: report.contacts.previous, format: "count" },
  ];

  const table: SummaryTable = {
    title: "Overdue follow-ups",
    columns: [
      { label: "Follow-up", format: "text" },
      { label: "With", format: "text" },
      { label: "Whose", format: "text" },
      { label: "Days late", format: "count" },
    ],
    rows: report.overdue.items.map((item) => [item.title, item.who ?? "—", item.owner, item.days]),
  };

  return { ...report, headlines, table };
}

// Gone-quiet opportunities (src/lib/gone-quiet.ts, the Pipeline's own
// rule), narrowed to one rep's when the picker says so.
async function quietFor(organizationId: string, repId: string | null) {
  const { quietDays, opportunities } = await goneQuietOpportunities(organizationId, { limit: 500 });
  const owners = opportunities.length
    ? await prisma.opportunity.findMany({ where: { id: { in: opportunities.map((row) => row.id) } }, select: { id: true, ownerId: true } })
    : [];
  const ownerOf = new Map(owners.map((row) => [row.id, row.ownerId]));
  const mine = opportunities.filter((row) => !repId || ownerOf.get(row.id) === repId);
  return {
    quietDays,
    count: mine.length,
    items: await withPrimary(organizationId, mine.slice(0, LIST).map((row) => ({ id: row.id, title: row.title, days: row.days, ownerId: ownerOf.get(row.id) ?? null }))),
  };
}

// Each quiet opportunity's Primary POC (one statement for the list), so the
// row names a person to call, with the company under it.
async function withPrimary<T extends { id: string }>(organizationId: string, rows: T[]) {
  if (!rows.length) return rows.map((row) => ({ ...row, person: null, company: null }));
  const links = await prisma.opportunityContact.findMany({
    where: { opportunityId: { in: rows.map((row) => row.id) }, role: "PRIMARY", opportunity: { organizationId } },
    select: { opportunityId: true, contact: { select: { id: true, name: true, mobile: true, phone: true, company: { select: { name: true } } } } },
  });
  const primary = new Map(links.map((link) => [link.opportunityId, link.contact]));
  return rows.map((row) => {
    const person = primary.get(row.id);
    return {
      ...row,
      person: person ? { id: person.id, name: person.name, phone: person.mobile || person.phone || null } : null,
      company: person?.company?.name ?? null,
    };
  });
}

/* ------------------------------- Team today ------------------------------- */

// Team today (BDR redesign, Nov 11, 2026): the strip on top of the Daily
// Rundown, one row per rep who owns records or logged a touch in the last
// 30 days (someone with neither, like an owner who doesn't sell, is left
// out). Each row: when they last logged something, Tries · Talks (with the
// connect rate) · Meetings booked today and this week, and a thin bar of
// their book's health. My day's three rings read the same numbers
// (`repNumbers`), so the two can never disagree.
//
// The rules: a try is a call, text, email or meeting logged by the rep,
// dated now or earlier, never a marketing send or a no-show, counted once
// per save (COALESCE(batchId, id): a call logged on three people is one
// try). A talk is a try with an outcome of Talked / They replied / Held,
// or a meeting with no outcome (old meetings count as held). A meeting
// booked is an OpportunityMeeting the rep booked (bookedById), by when it
// went on the calendar. "This week" is the report bar's This week; "last week" is
// the same days of the week before.

export type RepCounts = { tries: number; talks: number; booked: number };
export type RepNumbers = {
  today: RepCounts;
  week: RepCounts;
  lastWeek: RepCounts;
  lastLoggedAt: Date | null;
};

const CONNECT_SQL = Prisma.sql`(a.outcome IN ('TALKED', 'REPLIED', 'HELD') OR (a.type = 'MEETING' AND a.outcome IS NULL))`;

const zero = (): RepCounts => ({ tries: 0, talks: 0, booked: 0 });

export async function repNumbers(organizationId: string, repIds: string[], timeZone: string, now: Date): Promise<Map<string, RepNumbers>> {
  const result = new Map<string, RepNumbers>();
  if (repIds.length === 0) return result;
  const week = periodRange("this-week", timeZone, now);
  const today = periodRange("today", timeZone, now);
  const since = week.previous.from < today.from ? week.previous.from : today.from;
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  const [touches, booked, logged] = await Promise.all([
    prisma.$queryRaw<{ user_id: string; t_tries: number; t_talks: number; w_tries: number; w_talks: number; p_tries: number; p_talks: number }[]>`
      WITH t AS (
        SELECT a."userId" AS user_id, COALESCE(a."batchId", a.id) AS tid, MAX(a."occurredAt") AS at, bool_or(${CONNECT_SQL}) AS connect
          FROM "Activity" a
         WHERE a."organizationId" = ${organizationId} AND a."userId" = ANY(${repIds})
           AND a.marketing = false AND a.outcome IS DISTINCT FROM 'NO_SHOW'
           AND a."occurredAt" >= ${since} AND a."occurredAt" <= ${now}
         GROUP BY 1, 2
      )
      SELECT user_id,
             COUNT(*) FILTER (WHERE at >= ${today.from})::int AS t_tries,
             COUNT(*) FILTER (WHERE at >= ${today.from} AND connect)::int AS t_talks,
             COUNT(*) FILTER (WHERE at >= ${week.from})::int AS w_tries,
             COUNT(*) FILTER (WHERE at >= ${week.from} AND connect)::int AS w_talks,
             COUNT(*) FILTER (WHERE at >= ${week.previous.from} AND at < ${week.previous.to})::int AS p_tries,
             COUNT(*) FILTER (WHERE at >= ${week.previous.from} AND at < ${week.previous.to} AND connect)::int AS p_talks
        FROM t
       GROUP BY user_id`,
    // Dated by when the meeting went on the calendar: a meeting first tied
    // to an opportunity when it was marked Held (a calendar entry nobody
    // booked through the sheet) was booked when the entry was made, not
    // the day it was held.
    prisma.$queryRaw<{ user_id: string; t: number; w: number; p: number }[]>`
      WITH b AS (
        SELECT om."bookedById" AS user_id, LEAST(om."createdAt", COALESCE(e."createdAt", om."createdAt")) AS at
          FROM "OpportunityMeeting" om
          JOIN "Opportunity" o ON o.id = om."opportunityId"
          LEFT JOIN "CalendarEvent" e ON e.id = om."eventId" AND e."organizationId" = ${organizationId}
         WHERE o."organizationId" = ${organizationId} AND om."bookedById" = ANY(${repIds})
           AND om."createdAt" >= ${since}
      )
      SELECT user_id,
             COUNT(*) FILTER (WHERE at >= ${today.from} AND at <= ${now})::int AS t,
             COUNT(*) FILTER (WHERE at >= ${week.from} AND at <= ${now})::int AS w,
             COUNT(*) FILTER (WHERE at >= ${week.previous.from} AND at < ${week.previous.to})::int AS p
        FROM b
       GROUP BY 1`,
    prisma.$queryRaw<{ user_id: string; at: Date }[]>`
      SELECT a."userId" AS user_id, MAX(a."createdAt") AS at
        FROM "Activity" a
       WHERE a."organizationId" = ${organizationId} AND a."userId" = ANY(${repIds})
         AND a.marketing = false AND a."createdAt" >= ${monthAgo}
       GROUP BY 1`,
  ]);
  for (const id of repIds) result.set(id, { today: zero(), week: zero(), lastWeek: zero(), lastLoggedAt: null });
  for (const row of touches) {
    const entry = result.get(row.user_id);
    if (!entry) continue;
    entry.today.tries = num(row.t_tries);
    entry.today.talks = num(row.t_talks);
    entry.week.tries = num(row.w_tries);
    entry.week.talks = num(row.w_talks);
    entry.lastWeek.tries = num(row.p_tries);
    entry.lastWeek.talks = num(row.p_talks);
  }
  for (const row of booked) {
    const entry = result.get(row.user_id);
    if (!entry) continue;
    entry.today.booked = num(row.t);
    entry.week.booked = num(row.w);
    entry.lastWeek.booked = num(row.p);
  }
  for (const row of logged) {
    const entry = result.get(row.user_id);
    if (entry) entry.lastLoggedAt = row.at;
  }
  return result;
}

export type BookMix = { good: number; warn: number; risk: number; none: number; read: number; total: number };

export type TeamTodayRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  numbers: RepNumbers;
  mix: BookMix;
};

export type TeamToday = {
  reps: TeamTodayRow[];
  goals: { tries: number | null; talks: number | null; booked: number | null };
  // New leads nobody owns and nobody has touched yet (the unowned-leads
  // gap): they reach a call list only when somebody takes them.
  unowned: number;
};

// The statuses a rep is still working, for the book-health bar.
const OPEN_BOOK = ["NOT_ACTIONED", "CONTACTED", "CONNECTED", "INTERESTED", "MEETING_SET", "MEETING_COMPLETED", "QUOTE_SENT", "CONTRACT_SENT"];
// Health is worked out per person (leadHealth, never stored), so a big
// book is read from its most recently touched people: at most this many in
// all, shared out across the reps. The bar says when it is a sample.
const MIX_BUDGET = 1500;

// The teammates who sell: they own records or logged a touch in the last
// 30 days. Team today's rows, and the Activity report's Rep rows and its
// write-up, leave everyone else out (an owner who doesn't sell is not "the
// fewest"; Round 2).
export async function sellingReps(organizationId: string, now: Date) {
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  return prisma.$queryRaw<{ id: string; name: string; avatar_url: string | null }[]>`
      SELECT u.id, u.name, u."avatarUrl" AS avatar_url
        FROM "User" u
       WHERE u."organizationId" = ${organizationId} AND u."removedAt" IS NULL
         AND (EXISTS (SELECT 1 FROM "Contact" c WHERE c."organizationId" = ${organizationId} AND c."ownerId" = u.id)
           OR EXISTS (SELECT 1 FROM "Company" co WHERE co."organizationId" = ${organizationId} AND co."ownerId" = u.id)
           OR EXISTS (SELECT 1 FROM "Activity" a WHERE a."organizationId" = ${organizationId} AND a."userId" = u.id
                         AND a.marketing = false AND a."createdAt" >= ${monthAgo}))
       ORDER BY u.name`;
}

export async function loadTeamToday(organizationId: string, timeZone: string, now: Date): Promise<TeamToday> {
  const [people, org, unowned] = await Promise.all([
    sellingReps(organizationId, now),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { weeklyTryGoal: true, weeklyTalkGoal: true, weeklyMeetingGoal: true },
    }),
    prisma.contact.count({ where: { organizationId, ownerId: null, status: "NOT_ACTIONED", lastTouchAt: null } }),
  ]);
  const repIds = people.map((person) => person.id);
  const [numbers, mixes] = await Promise.all([repNumbers(organizationId, repIds, timeZone, now), bookMix(organizationId, repIds, now)]);
  return {
    reps: people.map((person) => ({
      id: person.id,
      name: person.name,
      avatarUrl: person.avatar_url,
      numbers: numbers.get(person.id) ?? { today: zero(), week: zero(), lastWeek: zero(), lastLoggedAt: null },
      mix: mixes.get(person.id) ?? { good: 0, warn: 0, risk: 0, none: 0, read: 0, total: 0 },
    })),
    goals: { tries: org?.weeklyTryGoal ?? null, talks: org?.weeklyTalkGoal ?? null, booked: org?.weeklyMeetingGoal ?? null },
    unowned,
  };
}

// Each rep's book by health tone, from leadHealth over their most recently
// touched open people (two batched statements for all of them).
async function bookMix(organizationId: string, repIds: string[], now: Date): Promise<Map<string, BookMix>> {
  const result = new Map<string, BookMix>();
  if (repIds.length === 0) return result;
  const perRep = Math.max(50, Math.min(400, Math.floor(MIX_BUDGET / repIds.length)));
  const [totals, sample, settings] = await Promise.all([
    prisma.$queryRaw<{ owner_id: string; n: number }[]>`
      SELECT c."ownerId" AS owner_id, COUNT(*)::int AS n
        FROM "Contact" c
       WHERE c."organizationId" = ${organizationId} AND c."ownerId" = ANY(${repIds})
         AND c.status::text = ANY(${OPEN_BOOK})
       GROUP BY 1`,
    prisma.$queryRaw<{ id: string; owner_id: string }[]>`
      SELECT s.id, r.id AS owner_id
        FROM unnest(${repIds}::text[]) AS r(id)
        CROSS JOIN LATERAL (
          SELECT c.id FROM "Contact" c
           WHERE c."organizationId" = ${organizationId} AND c."ownerId" = r.id
             AND c.status::text = ANY(${OPEN_BOOK})
           ORDER BY c."lastTouchAt" DESC NULLS LAST, c."createdAt" DESC
           LIMIT ${perRep}
        ) s`,
    healthSettings(organizationId),
  ]);
  for (const id of repIds) result.set(id, { good: 0, warn: 0, risk: 0, none: 0, read: 0, total: 0 });
  for (const row of totals) {
    const entry = result.get(row.owner_id);
    if (entry) entry.total = num(row.n);
  }
  const health = await loadContactHealth(organizationId, sample.map((row) => row.id), { settings, now });
  for (const row of sample) {
    const entry = result.get(row.owner_id);
    const one = health.get(row.id);
    if (!entry || !one) continue;
    entry[one.tone] += 1;
    entry.read += 1;
  }
  return result;
}
