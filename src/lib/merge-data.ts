import { prisma } from "@/lib/prisma";
import { formatCents, formatDate } from "@/lib/format";
import { computeQuoteTotals } from "@/lib/quote-math";
import { dealValueCents, QUOTES_FOR_VALUE, pickPrimaryQuote } from "@/lib/deals";
import { DEAL_STAGE_LABELS, type DealStageValue } from "@/lib/constants";
import type { MergeContext } from "@/lib/merge";
import { computeSchedule, dateToIso, type ScheduleRowInput } from "@/lib/payments";
import { formatAddress } from "@/lib/contracts";

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
  // Set by the deal tracker: the business the document goes to when it is
  // not the contact's own company (a purchase order to a supplier), the
  // rows split onto this contract, its payment schedule and who signs.
  companyId?: string | null;
  lineItems?: { name: string; quantity: number; unitPriceCents: number; tag: string }[];
  payments?: { label: string; amountCents: number; dueOn: Date | null }[];
  paymentTerms?: string | null;
  signerName?: string | null;
}): Promise<MergeContext> {
  const { organizationId } = input;

  const [organization, contact, deal, pickedCompany] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        name: true,
        timeZone: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        phone: true,
        email: true,
        website: true,
        description: true,
        history: true,
      },
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
    input.companyId
      ? prisma.company.findFirst({ where: { id: input.companyId, organizationId } })
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
  // The picked company wins over the contact's own: a PO goes to the
  // supplier even when the contact on it is the customer's foreman.
  const company = pickedCompany ?? contact?.company ?? null;
  const zone = organization.timeZone;

  // Product and total fields read from the contract's own rows when it
  // has them (a split), otherwise from the whole quote.
  const items = input.lineItems?.length ? input.lineItems : quote?.lineItems ?? [];
  const contractTotalCents = items.length ? computeQuoteTotals(items).totalCents : totals?.totalCents ?? null;

  const scheduleRows: ScheduleRowInput[] = (input.payments ?? []).map((row) => ({
    label: row.label,
    kind: "FIXED",
    percent: null,
    fixedCents: row.amountCents,
    dueOn: dateToIso(row.dueOn),
  }));
  const schedule = scheduleRows.length ? computeSchedule(scheduleRows, contractTotalCents ?? 0) : null;

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
    product_names: items.length ? items.map((item) => item.name).join(", ") : null,
    product_list: items.length ? itemLines(items) : null,

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
    contract_total: contractTotalCents === null ? null : formatCents(contractTotalCents),
    line_items: items.length ? itemLines(items) : null,
    payment_terms: input.paymentTerms || null,
    payment_schedule: schedule
      ? schedule.rows
          .map(
            (row) =>
              `${row.label}: ${formatCents(row.amountCents)}${row.dueOn ? ` due ${formatDate(`${row.dueOn}T12:00:00.000Z`, zone)}` : ""}`,
          )
          .join("\n")
      : null,
    final_payment_date: schedule?.finalDueOn
      ? formatDate(`${schedule.finalDueOn}T12:00:00.000Z`, zone)
      : null,
    your_signer_name: input.signerName || null,

    // Settings — your own company
    your_company_address: formatAddress(organization),
    your_company_phone: organization.phone || null,
    your_company_email: organization.email || null,
    your_company_website: organization.website || null,
    your_company_description: organization.description || null,
    your_company_history: organization.history || null,
  };
}

function itemLines(items: { name: string; quantity: number; unitPriceCents: number }[]) {
  return items
    .map(
      (item) =>
        `${trimQuantity(item.quantity)} × ${item.name} @ ${formatCents(item.unitPriceCents)} = ${formatCents(Math.round(item.quantity * item.unitPriceCents))}`,
    )
    .join("\n");
}

// "2" rather than "2.0", "1.5" stays "1.5".
function trimQuantity(quantity: number) {
  return String(quantity);
}
