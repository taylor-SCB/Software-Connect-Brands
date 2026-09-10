import { prisma } from "@/lib/prisma";
import { formatCents, formatDate } from "@/lib/format";
import { computeQuoteTotals } from "@/lib/quote-math";
import { dealValueCents, QUOTES_FOR_VALUE, pickPrimaryQuote } from "@/lib/deals";
import { DEAL_STAGE_LABELS, type DealStageValue } from "@/lib/constants";
import type { MergeContext } from "@/lib/merge";

// Server-side half of merge fields: reads the customer, deal and quote and
// turns them into the values a template's chips resolve to. Used both to
// generate a contract and to preview one, so what the preview shows is
// exactly what the generated document will say.
export async function loadMergeContext(input: {
  organizationId: string;
  contactId: string | null;
  dealId: string | null;
  quoteId: string | null;
  // "CON-1004" once a number is assigned; the preview passes the number the
  // next contract will get.
  contractNumber: string;
}): Promise<MergeContext> {
  const { organizationId } = input;

  const [organization, contact, deal] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, timeZone: true },
    }),
    input.contactId
      ? prisma.contact.findFirst({
          where: { id: input.contactId, organizationId },
          include: { company: true },
        })
      : null,
    input.dealId
      ? prisma.deal.findFirst({
          where: { id: input.dealId, organizationId },
          include: { quotes: QUOTES_FOR_VALUE },
        })
      : null,
  ]);

  // The quote: the one asked for if it belongs to the deal, otherwise the
  // deal's primary quote (the same one the pipeline reads the value from).
  const quoteId =
    input.quoteId && deal
      ? input.quoteId
      : deal
        ? pickPrimaryQuote(
            await prisma.quote.findMany({
              where: { dealId: deal.id, organizationId },
              select: { id: true, status: true, updatedAt: true },
            }),
          )?.id ?? null
        : null;

  const quote = quoteId
    ? await prisma.quote.findFirst({
        where: { id: quoteId, organizationId, ...(deal ? { dealId: deal.id } : {}) },
        include: { lineItems: { orderBy: { position: "asc" } } },
      })
    : null;

  const totals = quote ? computeQuoteTotals(quote.lineItems) : null;
  const company = contact?.company ?? null;
  const zone = organization.timeZone;

  return {
    // Contacts
    client_name: contact?.name ?? null,
    client_title: contact?.title || null,
    client_email: contact?.email || null,
    client_phone: contact?.phone || null,
    client_city: contact?.city || null,
    client_state: contact?.state || null,

    // Companies — a residential customer has no company; their own name
    // stands in so "between X and Y" still reads.
    client_company: company?.name || contact?.name || null,
    company_phone: company?.phone || null,
    company_email: company?.email || null,
    company_website: company?.website || null,
    company_city: company?.city || null,
    company_state: company?.state || null,

    // Pipeline
    deal_name: deal?.title ?? null,
    deal_stage: deal ? (DEAL_STAGE_LABELS[deal.stage as DealStageValue] ?? deal.stage) : null,
    deal_value: deal ? formatCents(dealValueCents(deal)) : null,

    // Products
    product_names:
      quote && quote.lineItems.length ? quote.lineItems.map((item) => item.name).join(", ") : null,
    product_list:
      quote && quote.lineItems.length
        ? quote.lineItems
            .map(
              (item) =>
                `${trimQuantity(item.quantity)} × ${item.name} @ ${formatCents(item.unitPriceCents)}`,
            )
            .join("\n")
        : null,

    // Quotes
    quote_number: quote ? `QUO-${quote.number}` : null,
    quote_title: quote?.title ?? null,
    quote_total: totals ? formatCents(totals.totalCents) : null,
    quote_valid_until: quote?.validUntil ? formatDate(quote.validUntil, zone) : null,
    quote_terms: quote?.terms || null,
    quote_labor_total: totals ? formatCents(totals.byTag.LABOR) : null,
    quote_materials_total: totals ? formatCents(totals.byTag.MATERIALS) : null,
    quote_software_total: totals ? formatCents(totals.byTag.SOFTWARE) : null,
    quote_project_services_total: totals ? formatCents(totals.byTag.PROJECT_SERVICES) : null,
    quote_shipping_total: totals ? formatCents(totals.byTag.SHIPPING) : null,
    quote_taxes_total: totals ? formatCents(totals.byTag.TAXES) : null,

    // Contracts
    company_name: organization.name,
    contract_number: input.contractNumber,
    date: formatDate(new Date(), zone),
  };
}

// "2" rather than "2.0", "1.5" stays "1.5".
function trimQuantity(quantity: number) {
  return String(quantity);
}
