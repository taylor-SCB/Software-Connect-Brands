import { prisma } from "@/lib/prisma";
import { goneQuietOpportunities } from "@/lib/gone-quiet";
import { OVERDUE_TYPES } from "@/lib/calendar-data";
import { computeQuoteTotals } from "@/lib/quote-math";
import { loadTeam, nameOf, num, type Headline, type ReportParams, type SummaryTable } from "@/lib/reports/common";
import { addDaysIso, daysBetweenIso, periodRange } from "@/lib/reports/period";
import { Prisma } from "@/generated/prisma/client";

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
  calendar: { count: number; open: number; items: { id: string; title: string; type: string; time: string | null; owner: string; who: string | null; done: boolean }[] };
  overdue: { count: number; items: { id: string; title: string; type: string; on: string; days: number; owner: string; who: string | null }[] };
  quiet: { count: number; quietDays: number; items: { id: string; title: string; days: number; owner: string }[] };
  payments: { cents: number; count: number; previousCents: number; items: { customer: string; cents: number; method: string | null }[] };
  quotes: { count: number; cents: number; items: { id: string; number: number; title: string; customer: string; cents: number }[] };
  contracts: { count: number; items: { id: string; number: number; title: string; customer: string }[] };
  contacts: { count: number; previous: number; items: { id: string; name: string; company: string | null }[] };
  headlines: Headline[];
  table: SummaryTable;
};

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
  const calendarSelect = { id: true, title: true, type: true, startTime: true, endTime: true, ownerId: true, doneAt: true, contact: { select: { name: true } }, company: { select: { name: true } } } as const;
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
      select: { id: true, title: true, type: true, startOn: true, ownerId: true, contact: { select: { name: true } }, company: { select: { name: true } } },
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
      items: calendar.map((event) => ({
        id: event.id,
        title: event.title,
        type: event.type,
        time: event.startTime ? (event.endTime ? `${event.startTime}–${event.endTime}` : event.startTime) : null,
        owner: nameOf(team, event.ownerId),
        who: event.contact?.name ?? event.company?.name ?? null,
        done: Boolean(event.doneAt),
      })),
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
        };
      }),
    },
    quiet: { count: quiet.count, quietDays: quiet.quietDays, items: quiet.items.map((item) => ({ ...item, owner: nameOf(team, item.ownerId) })) },
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
    items: mine.slice(0, LIST).map((row) => ({ id: row.id, title: row.title, days: row.days, ownerId: ownerOf.get(row.id) ?? null })),
  };
}
