import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { CONTACT_STATUS_LABELS, DEAL_STAGE_LABELS, ACTIVITY_LABELS, type ContactStatusValue, type DealStageValue } from "@/lib/constants";
import { dealValueCents, QUOTES_FOR_VALUE } from "@/lib/deals";
import { computeQuoteTotals } from "@/lib/quote-math";
import { formatCents, formatDate } from "@/lib/format";
import { askAi, stampOf, writeDraft, type AiResult } from "@/lib/ai";

// "Before you call" (Oct 2, 2026): everything the business has done with
// one person, across their main company and every Additional Account, as
// a list of plain facts — and, on request, one paragraph the AI writes
// from exactly those facts. The facts are always shown; the paragraph is
// kept until the facts change, so nobody pays for it twice.

export type BriefingFacts = {
  // One group per company they are part of, the main one first; a
  // homeowner has a single group with no company.
  groups: { company: string | null; main: boolean; lines: string[] }[];
  recent: string[];
  personal: string[];
};

export async function gatherBriefing(organizationId: string, contactId: string, timeZone: string): Promise<BriefingFacts | null> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, organizationId },
    select: {
      name: true,
      title: true,
      status: true,
      company: { select: { id: true, name: true, status: true } },
      accounts: { select: { company: { select: { id: true, name: true, status: true } } } },
      deals: {
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: { title: true, stage: true, valueCents: true, stageChangedAt: true, quotes: QUOTES_FOR_VALUE },
      },
      quotes: {
        where: { status: "SENT" },
        orderBy: { sentAt: "desc" },
        take: 10,
        select: {
          number: true,
          title: true,
          sentAt: true,
          discountCents: true,
          discountPercent: true,
          lineItems: { select: { quantity: true, unitPriceCents: true, discountCents: true, tag: true } },
        },
      },
      activities: {
        orderBy: { occurredAt: "desc" },
        take: 6,
        select: { type: true, body: true, occurredAt: true, user: { select: { name: true } } },
      },
      notes: {
        where: { label: { in: ["PERSONAL", "BIRTHDAY", "HOBBIES", "FAMILY"] } },
        orderBy: { createdAt: "desc" },
        take: 4,
        select: { body: true },
      },
    },
  });
  if (!contact) return null;

  const companies = [
    ...(contact.company ? [{ ...contact.company, main: true }] : []),
    ...contact.accounts.map((row) => ({ ...row.company, main: false })),
  ];
  const companyIds = companies.map((company) => company.id);

  // Paperwork and jobs at each of their companies, whoever there it was with.
  const [contracts, projects] = await Promise.all([
    companyIds.length
      ? prisma.contract.findMany({
          where: { organizationId, companyId: { in: companyIds }, status: { in: ["SENT", "SIGNED"] } },
          orderBy: { updatedAt: "desc" },
          take: 30,
          select: { companyId: true, number: true, title: true, status: true, sentAt: true, contact: { select: { name: true } } },
        })
      : prisma.contract.findMany({
          where: { organizationId, contactId, status: { in: ["SENT", "SIGNED"] } },
          orderBy: { updatedAt: "desc" },
          take: 10,
          select: { companyId: true, number: true, title: true, status: true, sentAt: true, contact: { select: { name: true } } },
        }),
    prisma.project.findMany({
      where: { organizationId, OR: [{ contactId }, ...(companyIds.length ? [{ companyId: { in: companyIds } }] : [])] },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { companyId: true, number: true, name: true, stage: true, awardedCents: true },
    }),
  ]);

  const statusLabel = (status: string) => CONTACT_STATUS_LABELS[status as ContactStatusValue] ?? status;
  const groups: BriefingFacts["groups"] = (companies.length ? companies : [null]).map((company) => {
    const lines: string[] = [];
    if (company) lines.push(`${company.name} is at ${statusLabel(company.status)}.`);
    if (!company || company.main) {
      lines.unshift(`${contact.name}${contact.title ? `, ${contact.title}` : ""}, is at ${statusLabel(contact.status)}.`);
      for (const deal of contact.deals) {
        lines.push(
          `Deal "${deal.title}" (${formatCents(dealValueCents(deal))}) is at ${DEAL_STAGE_LABELS[deal.stage as DealStageValue] ?? deal.stage} since ${formatDate(deal.stageChangedAt, timeZone)}.`,
        );
      }
      for (const quote of contact.quotes) {
        const total = computeQuoteTotals(quote.lineItems, quote).totalCents;
        lines.push(`Quote QUO-${quote.number} "${quote.title}" for ${formatCents(total)} is out${quote.sentAt ? ` since ${formatDate(quote.sentAt, timeZone)}` : ""}, no answer yet.`);
      }
    }
    const theirs = (row: { companyId: string | null }) => (company ? row.companyId === company.id : true);
    for (const contract of contracts.filter(theirs)) {
      const withWho = contract.contact.name === contact.name ? "" : ` (with ${contract.contact.name})`;
      lines.push(
        contract.status === "SIGNED"
          ? `Contract CON-${contract.number} "${contract.title}" is signed${withWho}.`
          : `Contract CON-${contract.number} "${contract.title}" is out for signature${contract.sentAt ? ` since ${formatDate(contract.sentAt, timeZone)}` : ""}${withWho}.`,
      );
    }
    for (const project of projects.filter(theirs)) {
      lines.push(`Job PRJ-${project.number} "${project.name}" is ${project.stage.toLowerCase().replace(/_/g, " ")}, ${formatCents(project.awardedCents)} awarded.`);
    }
    return { company: company?.name ?? null, main: company?.main ?? true, lines };
  });

  return {
    groups,
    recent: contact.activities.map(
      (row) => `${formatDate(row.occurredAt, timeZone)} · ${ACTIVITY_LABELS[row.type]} by ${row.user.name}: ${row.body.slice(0, 160)}`,
    ),
    personal: contact.notes.map((note) => note.body.slice(0, 200)),
  };
}

const paragraphSchema = z.object({
  paragraph: z.string().describe("One paragraph, four sentences at most, plain words."),
});

export type Briefing = { paragraph: string; writtenAt: string };

export function briefingKey(contactId: string) {
  return `briefing:${contactId}`;
}

/** The paragraph on file, and whether the facts have moved since it was written. */
export async function storedBriefing(organizationId: string, contactId: string, facts: BriefingFacts) {
  const row = await prisma.aiDraft.findUnique({
    where: { organizationId_key: { organizationId, key: briefingKey(contactId) } },
    select: { stamp: true, body: true },
  });
  if (!row) return null;
  return { ...(row.body as Briefing), stale: row.stamp !== stampOf(facts) };
}

export async function writeBriefing(input: {
  organizationId: string;
  userId: string;
  timeZone: string;
  contactId: string;
  contactName: string;
  facts: BriefingFacts;
}): Promise<AiResult<Briefing>> {
  const facts = input.facts;
  const text = [
    ...facts.groups.map((group) => `${group.company ? `At ${group.company}${group.main ? " (main company)" : ""}` : "On their own"}:\n- ${group.lines.join("\n- ") || "nothing yet"}`),
    `Latest touches:\n- ${facts.recent.join("\n- ") || "none logged"}`,
    facts.personal.length ? `Personal notes:\n- ${facts.personal.join("\n- ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const result = await askAi({
    organizationId: input.organizationId,
    userId: input.userId,
    timeZone: input.timeZone,
    feature: "briefing",
    effort: "low",
    maxTokens: 2000,
    schema: paragraphSchema,
    system:
      "You brief a salesperson at a small trade or service business right before they call someone. Write one short paragraph in plain, friendly words: where things stand across every company this person is part of, what is open or waiting on them, and one thing worth bringing up. Use only the facts given; never invent amounts, dates or names. No headings, no bullet points.",
    prompt: `Brief me on ${input.contactName}.\n\n${text}`,
  });
  if (!result.ok) return result;
  const briefing = { paragraph: result.data.paragraph.trim(), writtenAt: new Date().toISOString() };
  await writeDraft(input.organizationId, briefingKey(input.contactId), stampOf(facts), briefing);
  return { ok: true, data: briefing };
}
