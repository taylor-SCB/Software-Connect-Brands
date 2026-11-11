import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OPEN_OPPORTUNITY, opportunityColumn } from "@/lib/opportunities";
import { dealValueCents, QUOTES_FOR_VALUE } from "@/lib/deals";
import { PIPELINE_COLUMN_LABELS, type PipelineColumn } from "@/lib/constants";
import { isoDiff, zoneDay, type LeadHealth } from "@/lib/health";
import { waitingMeetings } from "@/lib/meetings";

// The company page's own reads (BDR redesign, Nov 11, 2026). Every one is
// scoped to the workspace and batched over the page's people: never one
// statement per row.

// Who to call's order: people being worked, furthest along first (a
// contract out, a quote out, a meeting had or booked, interested, talked,
// tried), then people never tried, then customers, then the closed ones.
// Within a stage the warmest first (health is worked out per page).
const STAGE_ORDER = [
  "CONTRACT_SENT",
  "QUOTE_SENT",
  "MEETING_COMPLETED",
  "MEETING_SET",
  "INTERESTED",
  "CONNECTED",
  "CONTACTED",
  "NOT_ACTIONED",
  "WON",
  "NOT_INTERESTED",
  "LOST",
  "ARCHIVED",
] as const;

export function stageOrder(status: string) {
  const index = (STAGE_ORDER as readonly string[]).indexOf(status);
  return index === -1 ? STAGE_ORDER.length : index;
}

const STAGE_CASE = Prisma.sql`CASE c.status::text ${Prisma.join(
  STAGE_ORDER.map((status, index) => Prisma.sql`WHEN ${status} THEN ${index}`),
  " ",
)} ELSE ${STAGE_ORDER.length} END`;

// One page of the company's people (its own and anyone linked to it as an
// additional account), in Who to call's stage order.
export async function whoToCallPage(organizationId: string, companyId: string, linkedIds: string[], page: number, perPage: number) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM "Contact" c
     WHERE c."organizationId" = ${organizationId}
       AND (c."companyId" = ${companyId} ${linkedIds.length ? Prisma.sql`OR c.id = ANY(${linkedIds})` : Prisma.empty})
     ORDER BY ${STAGE_CASE}, c.favorite DESC, c."lastTouchAt" DESC NULLS LAST, c.name ASC, c.id ASC
     LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`;
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];
  const people = await prisma.contact.findMany({
    where: { organizationId, id: { in: ids } },
    select: { id: true, name: true, title: true, email: true, phone: true, phone2: true, mobile: true, status: true, favorite: true, companyId: true },
  });
  const byId = new Map(people.map((person) => [person.id, person]));
  return ids.flatMap((id) => {
    const person = byId.get(id);
    return person ? [person] : [];
  });
}

// "VM", "No answer", "Talked": how a touch went, in the fewest words.
const SHORT_OUTCOME: Record<string, string> = {
  NO_ANSWER: "No answer",
  VOICEMAIL: "VM",
  GATEKEEPER: "Front desk",
  BAD_NUMBER: "Wrong number",
  TALKED: "Talked",
  REPLIED: "Replied",
  HELD: "Met",
  NO_SHOW: "No-show",
};

const SHORT_TYPE: Record<string, string> = { PHONE_CALL: "Call", TEXT: "Text", EMAIL: "Email", MEETING: "Meeting" };

function shortTouch(type: string, outcome: string | null) {
  if (outcome === "SENT") return type === "EMAIL" ? "Email sent" : type === "TEXT" ? "Text sent" : "Sent";
  if (outcome && SHORT_OUTCOME[outcome]) return SHORT_OUTCOME[outcome];
  return SHORT_TYPE[type] ?? type;
}

// "Last: VM · 3d · 4 tries" for each person: their latest touch (never a
// marketing send, nothing dated ahead) in one statement, with the tries
// and the days counted the way their health counts them.
export async function lastTouchLines(
  organizationId: string,
  ids: string[],
  health: Map<string, LeadHealth>,
  timeZone: string,
  now: Date,
): Promise<Map<string, string>> {
  const lines = new Map<string, string>();
  if (ids.length === 0) return lines;
  const rows = await prisma.$queryRaw<{ contactId: string; type: string; outcome: string | null; occurredAt: Date }[]>`
    SELECT DISTINCT ON (a."contactId") a."contactId", a.type::text AS type, a.outcome::text AS outcome, a."occurredAt"
      FROM "Activity" a
     WHERE a."organizationId" = ${organizationId} AND a."contactId" = ANY(${ids})
       AND a.marketing = false AND a."occurredAt" <= ${now}
     ORDER BY a."contactId", a."occurredAt" DESC, a.id DESC`;
  const today = zoneDay(now, timeZone);
  for (const row of rows) {
    const days = isoDiff(today, zoneDay(row.occurredAt, timeZone));
    const tries = health.get(row.contactId)?.counts.tries ?? 0;
    const parts = [shortTouch(row.type, row.outcome), days <= 0 ? "today" : `${days}d`];
    if (tries > 0) parts.push(`${tries} ${tries === 1 ? "try" : "tries"}`);
    lines.set(row.contactId, `Last: ${parts.join(" · ")}`);
  }
  return lines;
}

// The people who are the Primary POC on an open Pipeline tile: "Main
// contact" on their row.
export async function mainContactIds(organizationId: string, ids: string[]) {
  if (ids.length === 0) return new Set<string>();
  const rows = await prisma.opportunityContact.findMany({
    where: { contactId: { in: ids }, role: "PRIMARY", opportunity: { organizationId, ...OPEN_OPPORTUNITY } },
    select: { contactId: true },
  });
  return new Set(rows.map((row) => row.contactId));
}

export type OpportunitySummary = {
  id: string;
  title: string;
  stage: string;
  primary: { id: string; name: string } | null;
  valueCents: number | null;
  label: string | null;
  owner: string | null;
  meetingOn: Date | null;
};

// The company's open Pipeline tiles (anyone here on one, Do Not List or
// not), the latest first.
export async function openOpportunities(organizationId: string, companyId: string): Promise<{ list: OpportunitySummary[]; total: number }> {
  const where: Prisma.OpportunityWhereInput = {
    organizationId,
    AND: [OPEN_OPPORTUNITY, { contacts: { some: { contact: { companyId } } } }],
  };
  const [rows, total] = await Promise.all([
    prisma.opportunity.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: {
        id: true,
        title: true,
        stage: true,
        leadLabel: true,
        owner: { select: { name: true } },
        deal: { select: { stage: true, valueCents: true, quotes: QUOTES_FOR_VALUE } },
        contacts: { where: { role: "PRIMARY" }, take: 1, select: { contact: { select: { id: true, name: true } } } },
        meetings: { orderBy: { on: "desc" }, take: 1, select: { on: true } },
      },
    }),
    prisma.opportunity.count({ where }),
  ]);
  return {
    total,
    list: rows.map((row) => {
      const column = opportunityColumn(row);
      return {
        id: row.id,
        title: row.title,
        stage: column === "ARCHIVED" ? "Archived" : (PIPELINE_COLUMN_LABELS[column as PipelineColumn] ?? column),
        primary: row.contacts[0]?.contact ?? null,
        valueCents: row.deal ? dealValueCents(row.deal) : null,
        label: row.leadLabel,
        owner: row.owner?.name ?? null,
        meetingOn: row.meetings[0]?.on ?? null,
      };
    }),
  };
}

// The meeting the main button means, for one person, by the one rule
// every screen shares (waitingMeetings, src/lib/meeting-rule.ts: only
// tiles they are on as Primary or Associated, the latest one gone by when
// nobody said how it went and nothing is booked ahead — "Mark held" — or
// the next one still to come — "Meeting Tue 10:00 AM" with Reschedule).
// A calendar meeting entry no Pipeline meeting stands behind (from before
// every meeting landed on one), not ticked done, stands in when there is
// no Pipeline meeting either way.
export async function meetingFor(organizationId: string, contactId: string, now: Date, today: string, timeZone?: string) {
  const [waitingMap, entries] = await Promise.all([
    waitingMeetings(organizationId, { contactIds: [contactId] }, { now, timeZone }),
    prisma.calendarEvent.findMany({
      where: {
        organizationId,
        doneAt: null,
        activityId: null,
        type: { equals: "Meeting", mode: "insensitive" },
        startOn: { lte: new Date(`${today}T00:00:00.000Z`) },
        OR: [{ contactId }, { attendees: { some: { id: contactId } } }],
      },
      orderBy: { startOn: "desc" },
      take: 10,
      select: { id: true },
    }),
  ]);
  const waiting = waitingMap.get(contactId);
  const covered = entries.length
    ? new Set(
        (
          await prisma.opportunityMeeting.findMany({
            where: { eventId: { in: entries.map((row) => row.id) }, opportunity: { organizationId } },
            select: { eventId: true },
          })
        ).map((row) => row.eventId),
      )
    : new Set<string | null>();
  const entry = waiting?.ahead || waiting?.last ? null : (entries.find((row) => !covered.has(row.id)) ?? null);
  return {
    pastMeetingId: waiting?.due?.id ?? null,
    aheadMeetingId: waiting?.ahead?.id ?? null,
    aheadOn: waiting?.ahead?.day ?? null,
    entryId: entry?.id ?? null,
  };
}
