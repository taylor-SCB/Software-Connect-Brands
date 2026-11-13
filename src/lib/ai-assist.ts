import { prisma } from "@/lib/prisma";
import { ruleLeadLabel, type RuleSuggestion } from "@/lib/lead-label-rules";

// The AI helpers on the Pipeline, quotes and the contacts import (Nov 10,
// 2026; Taylor's CTO Think Tank). Everything here only reads: what each
// helper hands Claude, and the rules that run before Claude is asked.
// Every answer is a suggestion a person accepts; nothing is saved or sent
// on its own (src/lib/ai.ts).

// Each kind's allowance per workspace per rolling 24 hours. Small prompts
// at low effort on claude-opus-5-5 ($4 in / $20 out per million tokens):
// a follow-up or meeting read is about 2 cents, a quote draft with 40
// catalog candidates about 5, a header guess or a lead label under 1.
export const AI_DAILY_CAPS = {
  FOLLOW_UP_DRAFT: 200,
  MEETING_TO_OPPORTUNITY: 150,
  QUOTE_DRAFT: 100,
  IMPORT_HEADERS: 50,
  LEAD_LABEL: 200,
  // My day's greeting, reworded on request (BDR redesign, Round 2).
  MY_DAY_GREETING: 200,
  // The AI release (Nov 12, 2026; plan: the "AI Release Plan" artifact).
  // Costs are rough, at low effort unless the helper says otherwise.
  // Release A, sales and calendar.
  BRIEF: 300, // Brief me before a call or meeting, about 2 cents
  CALL_OPENER: 300, // a drafted opener on Up next, about 1 cent
  VOICE_LOG: 400, // Say it, don't type it: spoken words into the log sheet, under 1 cent
  FORECAST_NOTE: 60, // the sentences behind the Stats forecast, about 1 cent
  // Release B, contracts.
  PRICE_CHECK: 100, // the explanation lines of the price check before Create, about 1 cent
  SEND_CHECK: 100, // read before send, contract wording against the quote, about 5 cents
  REDLINE: 20, // a customer's marked-up copy read into changes, 10 to 30 cents
  CONTRACT_DATES: 50, // dated duties read from a signed contract, about 5 cents
  COMPLIANCE_READ: 30, // a COI, license or W-9 read for dates, name and limits, about 3 cents
  // Release C, jobs.
  PHOTO_TAGS: 500, // one photo's suggested Photo Type and Location, about 1 cent
  PUNCH_LIST: 20, // finished-install photos against the scope, about 15 cents
  CLOSEOUT_REPORT: 20, // the close-out photo report's pairs and lines, about 15 cents
  SITE_WALK: 50, // quote lines from site-walk photos and a sentence, about 10 cents
  RECEIPT_READ: 100, // a receipt photo read into a bill, about 2 cents
  JOB_QUESTION: 100, // a question answered from a job's own numbers, about 3 cents
  // The apparel pack (Nov 12, 2026).
  ARTWORK_CHECK: 100, // does an uploaded logo look like a famous brand's, about 1 cent; a warning only
  // Planner AI (Nov 12, 2026): a description of leads turned into filter chips, under 1 cent.
  PLANNER_FILTERS: 150,
} as const;

// How much meeting text one request carries at most.
const NOTE_CHARS = 2500;
const NOTES_TOTAL_CHARS = 8000;

export type MeetingNote = { on: Date; body: string; with: string };

// The notes of an opportunity's meetings, newest first: the bodies of the
// MEETING activities logged on the people listed on it (Do Not List left
// out) from the day before its first meeting on, or linked to one of its
// meetings. A meeting logged on three people is one note, not three.
export async function opportunityMeetingNotes(organizationId: string, opportunityId: string, limit = 6): Promise<MeetingNote[]> {
  const opportunity = await prisma.opportunity.findFirst({
    where: { id: opportunityId, organizationId },
    select: {
      createdAt: true,
      contacts: { where: { role: { not: "HIDDEN" } }, select: { contactId: true } },
      meetings: { select: { on: true, activityId: true } },
    },
  });
  if (!opportunity || opportunity.contacts.length === 0) return [];
  const firstMeeting = opportunity.meetings.reduce<Date>((min, row) => (row.on < min ? row.on : min), opportunity.createdAt);
  const since = new Date(firstMeeting.getTime() - 86_400_000);
  const linked = opportunity.meetings.map((row) => row.activityId).filter((id): id is string => Boolean(id));
  const rows = await prisma.activity.findMany({
    where: {
      organizationId,
      type: "MEETING",
      marketing: false,
      contactId: { in: opportunity.contacts.map((row) => row.contactId) },
      occurredAt: { lte: new Date() },
      OR: [{ occurredAt: { gte: since } }, ...(linked.length ? [{ id: { in: linked } }] : [])],
    },
    orderBy: { occurredAt: "desc" },
    take: 40,
    select: { body: true, batchId: true, occurredAt: true, contact: { select: { name: true } } },
  });
  const seen = new Set<string>();
  const notes: MeetingNote[] = [];
  let total = 0;
  for (const row of rows) {
    const body = row.body.trim();
    if (!body) continue;
    const key = row.batchId ?? `${row.occurredAt.toISOString()}|${body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const clipped = body.slice(0, NOTE_CHARS);
    if (total + clipped.length > NOTES_TOTAL_CHARS) break;
    total += clipped.length;
    notes.push({ on: row.occurredAt, body: clipped, with: row.contact?.name ?? "" });
    if (notes.length >= limit) break;
  }
  return notes;
}

// Notes as the prompt carries them: fenced, so words in a note read as the
// customer's, never as instructions. A "<" inside is written &lt; (final
// audit, Nov 11, 2026), so a note can't close its own fence with
// "</meeting>" and carry on as if it were the prompt.
const fenced = (text: string) => text.replace(/</g, "&lt;");
export function notesForPrompt(notes: MeetingNote[]) {
  return notes
    .map((note) => `<meeting date="${note.on.toISOString().slice(0, 10)}" with="${fenced(note.with.replace(/"/g, "'"))}">\n${fenced(note.body)}\n</meeting>`)
    .join("\n");
}

// The rule-based lead label for each opportunity given, keyed by id. Only
// the ones the rules have something to say about are in the map.
export async function ruleLeadLabels(organizationId: string, opportunityIds: string[]) {
  const result = new Map<string, RuleSuggestion>();
  if (opportunityIds.length === 0) return result;
  const rows = await prisma.opportunity.findMany({
    where: { organizationId, id: { in: opportunityIds } },
    select: {
      id: true,
      dealId: true,
      contacts: {
        where: { role: { not: "HIDDEN" } },
        select: {
          contact: {
            select: { id: true, email: true, email2: true, companyId: true, company: { select: { companyTypes: true } } },
          },
        },
      },
    },
  });
  const contactIds = [...new Set(rows.flatMap((row) => row.contacts.map((link) => link.contact.id)))];
  const won = contactIds.length
    ? await prisma.deal.findMany({
        where: { organizationId, stage: "WON", contactId: { in: contactIds } },
        select: { id: true, contactId: true },
      })
    : [];
  for (const row of rows) {
    const suggestion = ruleLeadLabel(
      row.contacts.map(({ contact }) => ({
        hasCompany: Boolean(contact.companyId),
        companyTypes: contact.company?.companyTypes ?? [],
        emails: [contact.email, contact.email2],
        hasWonDeal: won.some((deal) => deal.contactId === contact.id && deal.id !== row.dealId),
      })),
    );
    if (suggestion) result.set(row.id, suggestion);
  }
  return result;
}

// Words worth searching the catalog for in meeting notes: three letters or
// more, digits kept (4in, cat6), the commonest English and meeting words
// dropped.
const STOP_WORDS = new Set(
  (
    "the and for with that this from they them their there have has had will would could should about into also just " +
    "then than when what which while were was are our your you yours his her she him its it's not but all any can " +
    "need needs want wants wanted said says say talked talk discussed meeting met call called asked ask next week weeks " +
    "today tomorrow monday tuesday wednesday thursday friday saturday sunday quote price pricing cost budget customer " +
    "client job site per each some more most very much many one two three four five six seven eight nine ten " +
    "out off over under get got let lets how why who whom does did done do going go make made like looking look"
  ).split(" "),
);

export function catalogSearchWords(text: string, max = 30) {
  const words: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9.\-/]+/)) {
    const word = raw.replace(/^[.\-/]+|[.\-/]+$/g, "");
    if (word.length < 3 || STOP_WORDS.has(word) || /^\d+$/.test(word)) continue;
    if (!words.includes(word)) words.push(word);
    if (words.length >= max) break;
  }
  return words;
}

export type CatalogCandidate = {
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  priceCents: number;
  tag: string;
  labels: string[];
};

// The workspace's own active products that share a word with the notes,
// best match first: the only products, and the only prices, a drafted
// quote line may use.
export async function catalogCandidates(organizationId: string, text: string, take = 40): Promise<CatalogCandidate[]> {
  const words = catalogSearchWords(text);
  if (words.length === 0) return [];
  const found = await prisma.product.findMany({
    where: {
      organizationId,
      active: true,
      OR: words.flatMap((word) => [
        { name: { contains: word, mode: "insensitive" as const } },
        { sku: { contains: word, mode: "insensitive" as const } },
        { description: { contains: word, mode: "insensitive" as const } },
      ]),
    },
    take: 300,
    select: {
      id: true,
      name: true,
      sku: true,
      description: true,
      unitPriceCents: true,
      defaultTag: true,
      unitOfMeasure: true,
      customUnitId: true,
      customUnit: { select: { name: true } },
      variations: { select: { option: { select: { name: true, archivedAt: true } } }, take: 12 },
    },
  });
  const score = (row: (typeof found)[number]) => {
    const name = row.name.toLowerCase();
    const sku = (row.sku ?? "").toLowerCase();
    const description = row.description.toLowerCase();
    return words.reduce((sum, word) => sum + (name.includes(word) ? 3 : 0) + (sku.includes(word) ? 3 : 0) + (description.includes(word) ? 1 : 0), 0);
  };
  return found
    .map((row) => ({ row, points: score(row) }))
    .sort((a, b) => b.points - a.points || a.row.name.localeCompare(b.row.name))
    .slice(0, take)
    .map(({ row }) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      unit: row.unitOfMeasure ?? (row.customUnitId ? (row.customUnit?.name ?? null) : null),
      priceCents: row.unitPriceCents,
      tag: row.defaultTag,
      labels: row.variations.filter((link) => !link.option.archivedAt).map((link) => link.option.name),
    }));
}
