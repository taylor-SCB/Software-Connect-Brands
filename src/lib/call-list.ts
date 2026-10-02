import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatCents, formatDay } from "@/lib/format";
import { computeQuoteTotals } from "@/lib/quote-math";
import { dealValueCents, QUOTES_FOR_VALUE } from "@/lib/deals";
import { CONTRACT_ARCHIVE_DAYS } from "@/lib/constants";
import { OVERDUE_TYPES } from "@/lib/calendar-data";
import { askAi, readDrafts, stampOf, writeDraft } from "@/lib/ai";

// The morning Call List (Oct 2, 2026): who to call today and why. The list
// itself is rules over the status ladder, the calendar and the paperwork —
// readable, the same every time, free — and the AI only drafts the opening
// line for each call. Ticking a row logs the touch, which is also what
// takes it off: every rule asks "and nobody has touched them since".
//
// Whose list (Taylor, Oct 2, 2026: "mine + unclaimed"): a rep sees the deals
// they own, the follow-ups on their calendar, and the people they last
// touched or met. People nobody has touched yet sit in a shared "Nobody's"
// section. Owners and admins can open anyone's list.

const DAY = 86_400_000;

export type CallKind = "follow" | "held" | "noquote" | "quote" | "contract" | "interested";

export type CallRow = {
  key: string;
  kind: CallKind;
  contactId: string | null;
  companyId: string | null;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  reason: string;
  // Other reasons the same person is on the list, folded into one row.
  also: string[];
  score: number;
  ownerId: string | null;
  ownerName: string | null;
  eventId: string | null;
  // Every follow-up folded into this row, its own first: logging the call
  // ticks them all, so the person doesn't come straight back tomorrow.
  followUpIds: string[];
  dealId: string | null;
  quoteId: string | null;
};

export type CallScope = { userId: string } | "everyone";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const daysSince = (at: Date) => Math.max(0, Math.floor((Date.now() - at.getTime()) / DAY));

type Touch = { at: Date; userId: string };

/** The latest touch that has happened for each contact, and who made it. */
async function lastTouches(organizationId: string, contactIds: string[]) {
  if (contactIds.length === 0) return new Map<string, Touch>();
  const rows = await prisma.$queryRaw<{ key: string; at: Date; userId: string }[]>`
    SELECT DISTINCT ON (a."contactId") a."contactId" AS key, a."occurredAt" AS at, a."userId" AS "userId"
      FROM "Activity" a
     WHERE a."organizationId" = ${organizationId}
       AND a."contactId" = ANY(${contactIds})
       AND a."occurredAt" <= now()
     ORDER BY a."contactId", a."occurredAt" DESC, a."createdAt" DESC`;
  return new Map(rows.map((row) => [row.key, { at: row.at, userId: row.userId }]));
}

const PERSON = { id: true, name: true, phone: true, email: true, companyId: true, company: { select: { name: true } } } as const;

export async function buildCallList(organizationId: string, today: string): Promise<CallRow[]> {
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const rows: CallRow[] = [];

  const [followUps, meetings, metNoQuote, quoteDeals, contractDeals, interested, users] = await Promise.all([
    // Follow-ups due today or gone by unticked.
    prisma.calendarEvent.findMany({
      where: {
        organizationId,
        doneAt: null,
        activityId: null,
        type: { in: OVERDUE_TYPES.filter((type) => type !== "Meeting") },
        startOn: { lte: todayDate },
        OR: [{ contactId: { not: null } }, { companyId: { not: null } }],
      },
      orderBy: { startOn: "asc" },
      take: 300,
      select: {
        id: true,
        title: true,
        type: true,
        notes: true,
        startOn: true,
        ownerId: true,
        dealId: true,
        quoteId: true,
        contact: { select: PERSON },
        company: { select: { id: true, name: true, phone: true, email: true } },
      },
    }),
    // A meeting whose day has gone by, with someone still at Meeting Set.
    prisma.calendarEvent.findMany({
      where: { organizationId, type: "Meeting", startOn: { lt: todayDate }, contact: { status: "MEETING_SET" } },
      orderBy: { startOn: "desc" },
      take: 300,
      select: { id: true, startOn: true, ownerId: true, doneAt: true, contact: { select: PERSON } },
    }),
    // Met, and no quote yet three days on.
    prisma.$queryRaw<{ id: string; at: Date; userId: string | null }[]>`
      SELECT c.id, sc.on AS at, sc."userId" AS "userId"
        FROM "Contact" c
        JOIN LATERAL (
          SELECT s.on, s."userId" FROM "StatusChange" s
           WHERE s."contactId" = c.id AND s."toStatus" = 'MEETING_COMPLETED'
           ORDER BY s.on DESC LIMIT 1
        ) sc ON true
       WHERE c."organizationId" = ${organizationId}
         AND c.status = 'MEETING_COMPLETED'
         AND sc.on < now() - interval '3 days'
         AND NOT EXISTS (SELECT 1 FROM "Quote" q WHERE q."contactId" = c.id AND q."createdAt" >= sc.on)
       ORDER BY sc.on ASC
       LIMIT 300`,
    prisma.deal.findMany({
      where: { organizationId, stage: "QUOTE_SENT", stageChangedAt: { lt: new Date(Date.now() - 3 * DAY) } },
      orderBy: { stageChangedAt: "asc" },
      take: 300,
      select: {
        id: true,
        title: true,
        ownerId: true,
        stageChangedAt: true,
        valueCents: true,
        contact: { select: PERSON },
        quotes: {
          where: { status: "SENT" },
          orderBy: { sentAt: "desc" },
          take: 1,
          select: {
            id: true,
            number: true,
            sentAt: true,
            discountCents: true,
            discountPercent: true,
            lineItems: { select: { quantity: true, unitPriceCents: true, discountCents: true, tag: true } },
          },
        },
      },
    }),
    prisma.deal.findMany({
      where: { organizationId, stage: "CONTRACT_SENT", stageChangedAt: { lt: new Date(Date.now() - 7 * DAY) } },
      orderBy: { stageChangedAt: "asc" },
      take: 300,
      select: { id: true, title: true, ownerId: true, stageChangedAt: true, valueCents: true, quotes: QUOTES_FOR_VALUE, contact: { select: PERSON } },
    }),
    // Interested, quiet a week or more, and nothing booked with them.
    prisma.$queryRaw<{ id: string; since: Date | null }[]>`
      SELECT c.id, (SELECT max(s.on) FROM "StatusChange" s WHERE s."contactId" = c.id AND s."toStatus" = 'INTERESTED') AS since
        FROM "Contact" c
       WHERE c."organizationId" = ${organizationId}
         AND c.status = 'INTERESTED'
         AND NOT EXISTS (
           SELECT 1 FROM "Activity" a
            WHERE a."contactId" = c.id AND a."occurredAt" <= now() AND a."occurredAt" > now() - interval '7 days')
         AND NOT EXISTS (
           SELECT 1 FROM "CalendarEvent" e
            WHERE e."contactId" = c.id AND e."doneAt" IS NULL AND e."startOn" >= ${todayDate})
       ORDER BY c."updatedAt" ASC
       LIMIT 300`,
    prisma.user.findMany({ where: { organizationId }, select: { id: true, name: true } }),
  ]);

  const names = new Map(users.map((user) => [user.id, user.name]));
  const extraIds = [...metNoQuote.map((row) => row.id), ...interested.map((row) => row.id)];
  const extraPeople = extraIds.length
    ? await prisma.contact.findMany({ where: { organizationId, id: { in: extraIds } }, select: PERSON })
    : [];
  const people = new Map(extraPeople.map((person) => [person.id, person]));

  const allContactIds = [
    ...new Set([
      ...meetings.map((row) => row.contact?.id),
      ...quoteDeals.map((row) => row.contact.id),
      ...contractDeals.map((row) => row.contact.id),
      ...extraIds,
    ].filter((id): id is string => Boolean(id))),
  ];
  const touches = await lastTouches(organizationId, allContactIds);
  const touchedSince = (contactId: string, since: Date) => {
    const touch = touches.get(contactId);
    return Boolean(touch && touch.at > since);
  };

  type Person = { id: string; name: string; phone: string | null; email: string | null; companyId: string | null; company: { name: string } | null };
  const base = (person: Person) => ({
    contactId: person.id,
    companyId: person.companyId,
    name: person.name,
    company: person.company?.name ?? null,
    phone: person.phone,
    email: person.email,
    also: [] as string[],
    followUpIds: [] as string[],
    eventId: null as string | null,
    dealId: null as string | null,
    quoteId: null as string | null,
  });
  const owner = (ownerId: string | null | undefined) => ({ ownerId: ownerId ?? null, ownerName: ownerId ? (names.get(ownerId) ?? null) : null });

  for (const event of followUps) {
    const late = Math.max(0, Math.round((todayDate.getTime() - event.startOn.getTime()) / DAY));
    const what = event.type === "Quote due" ? "Quote expires" : event.notes.split("\n")[0]?.slice(0, 80) || event.type;
    const reason = late === 0 ? `${event.type} due today: ${what}` : `${event.type} ${plural(late, "day")} overdue: ${what}`;
    const person = event.contact
      ? base(event.contact)
      : {
          ...base({ id: "", name: event.company!.name, phone: event.company!.phone, email: event.company!.email, companyId: event.company!.id, company: null }),
          contactId: null,
        };
    rows.push({ ...person, key: `follow:${event.id}`, kind: "follow", reason, score: 70 + Math.min(late, 20), eventId: event.id, followUpIds: [event.id], dealId: event.dealId, quoteId: event.quoteId, ...owner(event.ownerId) });
  }

  // One row per person for an unmarked meeting: the latest one.
  const heldSeen = new Set<string>();
  for (const meeting of meetings) {
    if (!meeting.contact || heldSeen.has(meeting.contact.id)) continue;
    heldSeen.add(meeting.contact.id);
    rows.push({
      ...base(meeting.contact),
      key: `held:${meeting.id}`,
      kind: "held",
      reason: `Met on ${formatDay(meeting.startOn)}? It isn't marked held yet`,
      score: 85,
      eventId: meeting.id,
      ...owner(meeting.ownerId ?? touches.get(meeting.contact.id)?.userId),
    });
  }

  for (const row of metNoQuote) {
    const person = people.get(row.id);
    if (!person || touchedSince(row.id, new Date(Date.now() - 3 * DAY))) continue;
    rows.push({
      ...base(person),
      key: `noquote:${row.id}`,
      kind: "noquote",
      reason: `Met ${plural(daysSince(row.at), "day")} ago and no quote yet`,
      score: 75 + Math.min(daysSince(row.at), 15),
      ...owner(row.userId ?? touches.get(row.id)?.userId),
    });
  }

  for (const deal of quoteDeals) {
    const quote = deal.quotes[0];
    const sentAt = quote?.sentAt ?? deal.stageChangedAt;
    if (touchedSince(deal.contact.id, new Date(Math.max(sentAt.getTime(), Date.now() - 3 * DAY)))) continue;
    const days = daysSince(sentAt);
    const total = quote ? computeQuoteTotals(quote.lineItems, quote).totalCents : deal.valueCents;
    rows.push({
      ...base(deal.contact),
      key: `quote:${deal.id}`,
      kind: "quote",
      reason: `${quote ? `QUO-${quote.number}` : `Quote on "${deal.title}"`} for ${formatCents(total)} out ${plural(days, "day")}, no answer`,
      score: 60 + Math.min(days, 20) + Math.min(15, Math.max(0, Math.log10(Math.max(total, 100) / 100) * 4)),
      dealId: deal.id,
      quoteId: quote?.id ?? null,
      ...owner(deal.ownerId),
    });
  }

  for (const deal of contractDeals) {
    if (touchedSince(deal.contact.id, new Date(Date.now() - 7 * DAY))) continue;
    const days = daysSince(deal.stageChangedAt);
    const left = CONTRACT_ARCHIVE_DAYS - days;
    const value = dealValueCents(deal);
    rows.push({
      ...base(deal.contact),
      key: `contract:${deal.id}`,
      kind: "contract",
      reason:
        left <= 30
          ? `Contract on "${deal.title}" (${formatCents(value)}) out ${days} days — archives in ${plural(Math.max(left, 0), "day")}`
          : `Contract on "${deal.title}" (${formatCents(value)}) out ${days} days, not signed`,
      score: 65 + (left <= 30 ? 30 - Math.max(left, 0) / 2 + 15 : Math.min(days / 3, 10)),
      dealId: deal.id,
      ...owner(deal.ownerId),
    });
  }

  for (const row of interested) {
    const person = people.get(row.id);
    if (!person) continue;
    const touch = touches.get(row.id);
    const since = row.since ?? touch?.at ?? null;
    rows.push({
      ...base(person),
      key: `interested:${row.id}`,
      kind: "interested",
      reason: since ? `Interested for ${plural(daysSince(since), "day")}, no meeting booked` : "Interested, no meeting booked",
      score: 50 + Math.min(since ? daysSince(since) / 2 : 5, 15),
      ...owner(touch?.userId),
    });
  }

  // One row per person: the most pressing reason leads, the rest ride along.
  const byPerson = new Map<string, CallRow>();
  for (const row of rows.sort((a, b) => b.score - a.score)) {
    const who = row.contactId ?? `company:${row.companyId}`;
    const first = byPerson.get(who);
    if (first) {
      first.also.push(row.reason);
      first.followUpIds.push(...row.followUpIds);
    } else byPerson.set(who, row);
  }
  return [...byPerson.values()].sort((a, b) => b.score - a.score);
}

export function scopeRows(rows: CallRow[], scope: CallScope) {
  if (scope === "everyone") return { mine: rows, nobodys: [] as CallRow[] };
  return {
    mine: rows.filter((row) => row.ownerId === scope.userId),
    nobodys: rows.filter((row) => !row.ownerId),
  };
}

/* --------------------------------- Openers -------------------------------- */

export type Opener = { text: string };

function openerStamp(row: CallRow, today: string) {
  return stampOf([row.reason, row.also, today]);
}

export function openerKey(row: CallRow) {
  return `opener:${row.key}`;
}

/** Openers already written today for these rows. */
export async function storedOpeners(organizationId: string, rows: CallRow[], today: string) {
  const drafts = await readDrafts<Opener>(organizationId, rows.map(openerKey));
  const out = new Map<string, string>();
  for (const row of rows) {
    const draft = drafts.get(openerKey(row));
    if (draft && draft.stamp === openerStamp(row, today)) out.set(row.key, draft.body.text);
  }
  return out;
}

const openersSchema = z.object({
  openers: z.array(z.object({ id: z.string(), opener: z.string().describe("One or two friendly sentences to open the call with.") })),
});

export const MAX_OPENERS_PER_DRAFT = 15;

/** Writes openers for the rows that don't have one today, in one AI request. */
export async function draftOpeners(input: {
  organizationId: string;
  userId: string;
  userName: string;
  businessName: string;
  timeZone: string;
  today: string;
  rows: CallRow[];
}) {
  const have = await storedOpeners(input.organizationId, input.rows, input.today);
  const need = input.rows.filter((row) => !have.has(row.key)).slice(0, MAX_OPENERS_PER_DRAFT);
  if (need.length === 0) return { ok: true as const, openers: have };

  const result = await askAi({
    organizationId: input.organizationId,
    userId: input.userId,
    timeZone: input.timeZone,
    feature: "openers",
    effort: "low",
    maxTokens: 4000,
    schema: openersSchema,
    system:
      "You write the first thing a salesperson at a small trade or service business says when they call a customer back. One or two short, warm, natural sentences per call, in plain words: say who is calling, then the reason, then an easy question. No pressure, no exclamation marks, no made-up facts, amounts or dates beyond what is given.",
    prompt: `Caller: ${input.userName} from ${input.businessName}.\n\nCalls (id | who | why):\n${need
      .map((row, index) => `${index + 1} | ${row.name}${row.company ? ` at ${row.company}` : ""} | ${[row.reason, ...row.also].join("; ")}`)
      .join("\n")}\n\nReturn an opener for every id, using the id number given.`,
  });
  if (!result.ok) return { ok: false as const, error: result.error, openers: have };

  for (const item of result.data.openers) {
    const row = need[Number(item.id.replace(/\D/g, "")) - 1];
    if (!row || !item.opener.trim()) continue;
    const text = item.opener.trim().slice(0, 400);
    have.set(row.key, text);
    await writeDraft(input.organizationId, openerKey(row), openerStamp(row, input.today), { text });
  }
  return { ok: true as const, openers: have };
}
