import { prisma } from "@/lib/prisma";
import { pickPrimaryQuote } from "@/lib/deals";
import { dealJourney, type JourneyInput, type JourneyState } from "@/lib/health-journey";

// What the DealJourney strip on the quote, the Contract Coordinator and
// the contract reads (BDR redesign, Release 8), plus the records its one
// Next button acts on. Server only; four small reads for one deal.
//
// Which paperwork counts depends on the page:
// - the quote page: that quote, and the money-in contracts made from it;
// - the Coordinator: the quote picked there, and every money-in contract
//   on the deal;
// - the contract page: that contract alone, and the quote it came from.
// Purchase orders (money out) are never part of it, and a cancelled or
// declined contract counts as not made.
export type JourneyRefs = {
  dealId: string;
  contactId: string;
  quote: { id: string; number: number; status: string; publicToken: string } | null;
  // The contract the Next button means at each step.
  draftContract: { id: string; number: number } | null;
  sentContract: { id: string; number: number; publicToken: string } | null;
  signedContract: { id: string; number: number } | null;
  // The first row of the signed contract's payment table with money on it,
  // the deposit:
  // its id for "Send deposit invoice", and its invoice link once sent.
  depositRow: { id: string; invoiceToken: string | null; amountCents: number } | null;
};

export type LoadedJourney = { journey: JourneyState; input: JourneyInput; refs: JourneyRefs };

export async function loadDealJourney(
  organizationId: string,
  timeZone: string,
  scope: { dealId: string; quoteId?: string | null; contractId?: string | null; page: "quote" | "coordinator" | "contract" },
): Promise<LoadedJourney | null> {
  const [deal, meeting, contracts] = await Promise.all([
    prisma.deal.findFirst({
      where: { id: scope.dealId, organizationId },
      select: {
        id: true,
        contactId: true,
        quotes: {
          select: { id: true, number: true, status: true, sentAt: true, updatedAt: true, publicToken: true },
        },
      },
    }),
    prisma.opportunityMeeting.findFirst({
      where: { opportunity: { organizationId, dealId: scope.dealId } },
      orderBy: { on: "asc" },
      select: { on: true },
    }),
    prisma.contract.findMany({
      where: {
        organizationId,
        payable: false,
        status: { in: ["DRAFT", "SENT", "SIGNED"] },
        ...(scope.page === "contract" && scope.contractId
          ? { id: scope.contractId }
          : scope.page === "quote" && scope.quoteId
            ? { quoteId: scope.quoteId }
            : { dealId: scope.dealId }),
      },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        number: true,
        status: true,
        sentAt: true,
        signedAt: true,
        updatedAt: true,
        publicToken: true,
        quoteId: true,
        // The deposit is the first row with money on it (audit, Nov 11,
        // 2026): a $0 first row can never be invoiced or paid.
        payments: {
          where: { amountCents: { gt: 0 } },
          orderBy: { position: "asc" },
          take: 1,
          select: { id: true, paidAt: true, invoiceToken: true, amountCents: true },
        },
      },
    }),
  ]);
  if (!deal) return null;

  const wantedQuoteId =
    scope.quoteId ?? (scope.page === "contract" ? contracts[0]?.quoteId ?? null : null);
  const quote =
    (wantedQuoteId ? deal.quotes.find((candidate) => candidate.id === wantedQuoteId) : undefined) ??
    pickPrimaryQuote(deal.quotes) ??
    null;

  const earliest = (dates: (Date | null)[]) =>
    dates.reduce<Date | null>((min, at) => (at && (!min || at < min) ? at : min), null);
  const signed = contracts
    .filter((contract) => contract.status === "SIGNED")
    .sort((a, b) => (a.signedAt ?? a.updatedAt).getTime() - (b.signedAt ?? b.updatedAt).getTime());
  const sent = contracts.filter((contract) => contract.status === "SENT");
  const drafts = contracts.filter((contract) => contract.status === "DRAFT");
  const firstSigned = signed[0] ?? null;
  const deposit = firstSigned?.payments[0] ?? null;

  const input: JourneyInput = {
    meetingAt: meeting?.on ?? null,
    quoteSentAt: quote && quote.status !== "DRAFT" ? quote.sentAt ?? quote.updatedAt : null,
    contractSentAt: earliest([...sent, ...signed].map((contract) => contract.sentAt)) ?? (sent[0] ? sent[0].updatedAt : null),
    signedAt: firstSigned ? firstSigned.signedAt ?? firstSigned.updatedAt : null,
    // A signed contract with nothing to collect (no payment rows, or only
    // $0 ones) has no deposit to wait on: the last step is done when it is
    // signed, rather than sitting on "Send deposit invoice" for good.
    depositPaidAt: deposit ? deposit.paidAt : firstSigned ? (firstSigned.signedAt ?? firstSigned.updatedAt) : null,
    quoteDraft: quote?.status === "DRAFT",
    quoteAccepted: quote?.status === "ACCEPTED",
    contractDraft: drafts.length > 0,
  };

  return {
    input,
    journey: dealJourney(input, timeZone),
    refs: {
      dealId: deal.id,
      contactId: deal.contactId,
      quote: quote ? { id: quote.id, number: quote.number, status: quote.status, publicToken: quote.publicToken } : null,
      draftContract: drafts[0] ? { id: drafts[0].id, number: drafts[0].number } : null,
      sentContract: sent[0] ? { id: sent[0].id, number: sent[0].number, publicToken: sent[0].publicToken } : null,
      signedContract: firstSigned ? { id: firstSigned.id, number: firstSigned.number } : null,
      depositRow: deposit ? { id: deposit.id, invoiceToken: deposit.invoiceToken, amountCents: deposit.amountCents } : null,
    },
  };
}
