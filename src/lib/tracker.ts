import { prisma } from "@/lib/prisma";
import { contractHoldsRows, contractTotalCents } from "@/lib/contracts";
import { pickPrimaryQuote } from "@/lib/deals";

// Everything the Deal Tracker page needs for one deal: the quote and its
// rows (with which contract each row is already on), the contracts made
// off the deal so far, and the pick lists the grid's column headers use.

export const CONTRACT_LINE_STATE = ["OPEN", "SENT", "SIGNED", "DRAFT", "CANCELLED"] as const;

export async function loadTrackerPickers(organizationId: string) {
  const [companies, contacts, templates, owner] = await Promise.all([
    prisma.company.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, logoUrl: true },
    }),
    prisma.contact.findMany({
      where: { organizationId, status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, companyId: true, title: true },
    }),
    prisma.contractTemplate.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, type: true },
    }),
    // "Your Company Signer" starts as the owner — the admin role on the
    // account — and can be typed over.
    prisma.user.findFirst({
      where: { organizationId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: { name: true, title: true },
    }),
  ]);
  return { companies, contacts, templates, ownerName: owner?.name ?? "" };
}

export type TrackerPickers = Awaited<ReturnType<typeof loadTrackerPickers>>;

export async function loadTrackerDeal(organizationId: string, dealId: string) {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
    select: {
      id: true,
      title: true,
      stage: true,
      contact: {
        select: {
          id: true,
          name: true,
          imageUrl: true,
          companyId: true,
          company: { select: { id: true, name: true, logoUrl: true } },
        },
      },
      quotes: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          updatedAt: true,
          lineItems: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              name: true,
              description: true,
              quantity: true,
              unitPriceCents: true,
              tag: true,
              cancelledAt: true,
              contractLines: {
                select: {
                  contract: { select: { id: true, number: true, status: true, title: true, type: true } },
                },
              },
            },
          },
        },
      },
      contracts: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          number: true,
          title: true,
          type: true,
          status: true,
          sentAt: true,
          signedAt: true,
          cancelledAt: true,
          declinedAt: true,
          publicToken: true,
          paymentTerms: true,
          reminderCount: true,
          lastReminderAt: true,
          senderSignerName: true,
          company: { select: { id: true, name: true, logoUrl: true } },
          contact: { select: { id: true, name: true, company: { select: { name: true, logoUrl: true } } } },
          lineItems: { select: { quantity: true, unitPriceCents: true } },
          payments: {
            orderBy: { position: "asc" },
            select: { id: true, label: true, amountCents: true, dueOn: true, paidAt: true },
          },
        },
      },
    },
  });
  if (!deal) return null;

  const primary = pickPrimaryQuote(deal.quotes);

  return {
    id: deal.id,
    title: deal.title,
    stage: deal.stage,
    contact: deal.contact,
    primaryQuoteId: primary?.id ?? null,
    quotes: deal.quotes.map((quote) => ({
      id: quote.id,
      number: quote.number,
      title: quote.title,
      status: quote.status,
      lineItems: quote.lineItems.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        tag: item.tag,
        cancelled: Boolean(item.cancelledAt),
        // Only contracts still standing count; a cancelled or declined
        // one has let the row go.
        onContracts: item.contractLines
          .map((line) => line.contract)
          .filter((contract) => contractHoldsRows(contract.status))
          .map((contract) => ({
            id: contract.id,
            number: contract.number,
            status: contract.status,
            title: contract.title,
            type: contract.type,
          })),
      })),
    })),
    contracts: deal.contracts.map((contract) => {
      const totalCents = contractTotalCents(contract.lineItems);
      const paidCents = contract.payments
        .filter((payment) => payment.paidAt)
        .reduce((sum, payment) => sum + payment.amountCents, 0);
      const nextDue = contract.payments.find((payment) => !payment.paidAt) ?? null;
      return {
        id: contract.id,
        number: contract.number,
        title: contract.title,
        type: contract.type,
        status: contract.status,
        sentAt: contract.sentAt,
        signedAt: contract.signedAt,
        cancelledAt: contract.cancelledAt,
        declinedAt: contract.declinedAt,
        publicToken: contract.publicToken,
        paymentTerms: contract.paymentTerms,
        reminderCount: contract.reminderCount,
        lastReminderAt: contract.lastReminderAt,
        senderSignerName: contract.senderSignerName,
        recipientCompany: contract.company ?? contract.contact.company ?? null,
        recipientName: contract.contact.name,
        recipientContactId: contract.contact.id,
        lineCount: contract.lineItems.length,
        totalCents,
        paidCents,
        paymentCount: contract.payments.length,
        nextDue: nextDue ? { label: nextDue.label, amountCents: nextDue.amountCents, dueOn: nextDue.dueOn } : null,
      };
    }),
  };
}

export type TrackerDeal = NonNullable<Awaited<ReturnType<typeof loadTrackerDeal>>>;
export type TrackerQuote = TrackerDeal["quotes"][number];
export type TrackerLine = TrackerQuote["lineItems"][number];
export type TrackerContract = TrackerDeal["contracts"][number];

// The deals to offer in the picker: every deal, open ones first.
export async function loadTrackerDeals(organizationId: string) {
  const deals = await prisma.deal.findMany({
    where: { organizationId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      stage: true,
      contact: { select: { name: true, company: { select: { name: true } } } },
      _count: { select: { quotes: true, contracts: true } },
    },
  });
  return deals.map((deal) => ({
    id: deal.id,
    title: deal.title,
    stage: deal.stage,
    who: deal.contact.company?.name ? `${deal.contact.company.name} · ${deal.contact.name}` : deal.contact.name,
    quotes: deal._count.quotes,
    contracts: deal._count.contracts,
  }));
}
