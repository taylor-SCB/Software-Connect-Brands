import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { askAi, type AiResult } from "@/lib/ai";
import { addDays, todayIso } from "@/lib/payments";
import { formatCents } from "@/lib/format";

// Meeting notes that move the deal (Oct 2, 2026). A rep types or dictates
// a couple of lines after a meeting; the AI reads them into a proposal —
// a line for the contact's history, whether the meeting was held, a
// follow-up date, and the quote's lines picked from THIS workspace's own
// catalog at its own prices. Nothing changes until the rep ticks what they
// want and presses Apply (Taylor, Oct 2, 2026: "show me, one click to apply").
//
// Prices never come from the AI. It names catalog items by a short code
// and a quantity; the price on the draft quote is the product's own.

export const MAX_CATALOG = 300;

const readingSchema = z.object({
  summary: z.string().describe("One to three plain sentences for the contact's history: what happened and what they want. Include any budget and decision date mentioned."),
  meetingHappened: z.boolean().describe("True if the notes describe a meeting or site visit that already took place."),
  followUpDate: z.string().nullable().describe("YYYY-MM-DD for the next follow-up the notes ask for or imply, or null."),
  followUpWhat: z.string().describe("What the follow-up is for, a few words. Empty if none."),
  quoteWanted: z.boolean().describe("True if the customer wants pricing, a quote, a proposal or an estimate."),
  quoteTitle: z.string().describe("A short name for the job, e.g. 'North roof replacement'. Empty if no quote is wanted."),
  budgetDollars: z.number().nullable().describe("The customer's budget in dollars if stated, else null."),
  lines: z
    .array(
      z.object({
        code: z.string().describe("The catalog code, e.g. P12. Only codes from the catalog given."),
        quantity: z.number().describe("How many, in the item's unit."),
        note: z.string().describe("Why this line, a few words from the notes."),
      }),
    )
    .describe("Quote lines from the catalog only. Empty when nothing in the catalog fits."),
  notInCatalog: z.array(z.string()).describe("Things the job needs that no catalog item covers, a few words each."),
});

export type ProposedLine = {
  productId: string;
  name: string;
  unit: string | null;
  quantity: number;
  unitPriceCents: number;
  note: string;
};

export type NotesProposal = {
  summary: string;
  meetingHappened: boolean;
  followUp: { on: string; what: string } | null;
  quote: { title: string; budgetCents: number | null; lines: ProposedLine[]; notInCatalog: string[] } | null;
};

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });

function realDay(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

export async function readMeetingNotes(input: {
  organizationId: string;
  userId: string;
  timeZone: string;
  contactId: string;
  notes: string;
}): Promise<AiResult<NotesProposal>> {
  const contact = await prisma.contact.findFirst({
    where: { id: input.contactId, organizationId: input.organizationId },
    select: { name: true, company: { select: { name: true } } },
  });
  if (!contact) return { ok: false, error: "Contact not found" };

  const products = await prisma.product.findMany({
    where: { organizationId: input.organizationId, active: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_CATALOG,
    select: { id: true, name: true, sku: true, description: true, unitPriceCents: true, unitOfMeasure: true, defaultTag: true },
  });
  const codes = new Map(products.map((product, index) => [`P${index + 1}`, product]));
  const catalog = products.length
    ? products
        .map(
          (product, index) =>
            `P${index + 1} | ${product.name}${product.sku ? ` (${product.sku})` : ""} | ${formatCents(product.unitPriceCents)}${product.unitOfMeasure ? ` per ${product.unitOfMeasure.toLowerCase().replace(/_/g, " ")}` : ""} | ${product.defaultTag.toLowerCase()}${product.description ? ` | ${product.description.slice(0, 80)}` : ""}`,
        )
        .join("\n")
    : "(The catalog is empty.)";

  const today = todayIso(input.timeZone);
  const result = await askAi({
    organizationId: input.organizationId,
    userId: input.userId,
    timeZone: input.timeZone,
    feature: "meeting-notes",
    effort: "medium",
    maxTokens: 8000,
    schema: readingSchema,
    system: [
      "You read a salesperson's quick notes from a meeting with a customer of a small trade or service business, and turn them into a proposal the salesperson will check before anything is saved.",
      "Quote lines must come only from the catalog given, by code. Never invent a product or a price. If something the job needs is not in the catalog, list it under notInCatalog instead.",
      "Pick quantities from the notes; when the notes give a budget, keep the lines' total near it using the catalog's prices, and never pad lines to reach it.",
      "Resolve dates like 'the 15th' or 'next Tuesday' against today's date. When the notes ask for a follow-up without a date, choose three business days from today.",
    ].join(" "),
    prompt: `Today is ${WEEKDAY.format(new Date(`${today}T12:00:00Z`))}, ${today}.\nCustomer: ${contact.name}${contact.company ? ` at ${contact.company.name}` : ""}.\n\nCatalog (code | name | price | kind | description):\n${catalog}\n\nThe notes:\n${input.notes}`,
  });
  if (!result.ok) return result;

  const reading = result.data;
  const lines: ProposedLine[] = [];
  for (const line of reading.lines) {
    const product = codes.get(line.code.trim().toUpperCase());
    const quantity = Number(line.quantity);
    if (!product || !Number.isFinite(quantity) || quantity <= 0) continue;
    lines.push({
      productId: product.id,
      name: product.name,
      unit: product.unitOfMeasure ? product.unitOfMeasure.toLowerCase().replace(/_/g, " ") : null,
      quantity: Math.round(quantity * 100) / 100,
      unitPriceCents: product.unitPriceCents,
      note: line.note.slice(0, 200),
    });
  }
  const followOn = realDay(reading.followUpDate);
  // A follow-up in the past is a misread; three days on is the app's own rhythm.
  const followUp = reading.followUpWhat || followOn ? { on: followOn && followOn >= today ? followOn : addDays(today, 3), what: reading.followUpWhat || "Follow up" } : null;

  return {
    ok: true,
    data: {
      summary: reading.summary.trim().slice(0, 2000),
      meetingHappened: reading.meetingHappened,
      followUp,
      quote:
        reading.quoteWanted || lines.length
          ? {
              title: (reading.quoteTitle || "Quote from meeting").slice(0, 160),
              budgetCents: reading.budgetDollars != null && reading.budgetDollars > 0 ? Math.round(reading.budgetDollars * 100) : null,
              lines,
              notInCatalog: reading.notInCatalog.map((item) => item.slice(0, 120)).slice(0, 12),
            }
          : null,
    },
  };
}
