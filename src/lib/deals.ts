import { prisma } from "@/lib/prisma";
import { computeQuoteTotals } from "@/lib/quote-math";
import { DEAL_STAGES, OPEN_DEAL_STAGES, type DealStageValue } from "@/lib/constants";

type QuoteForValue = {
  status: string;
  updatedAt: Date;
  lineItems: { quantity: number; unitPriceCents: number; tag: string }[];
};

export type DealWithQuotes = {
  valueCents: number;
  quotes: QuoteForValue[];
};

// What a deal is worth. Once a quote exists the typed estimate stops
// counting: an accepted quote wins, otherwise the one most recently
// worked on that the customer hasn't declined, otherwise the newest.
export function dealValueCents(deal: DealWithQuotes): number {
  if (deal.quotes.length === 0) return deal.valueCents;
  const byRecency = [...deal.quotes].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  const pick =
    byRecency.find((quote) => quote.status === "ACCEPTED") ??
    byRecency.find((quote) => quote.status !== "DECLINED") ??
    byRecency[0];
  return computeQuoteTotals(pick.lineItems).totalCents;
}

export function isOpenStage(stage: string) {
  return (OPEN_DEAL_STAGES as readonly string[]).includes(stage);
}

// Prisma `select` for the quote fields dealValueCents needs.
export const QUOTES_FOR_VALUE = {
  select: {
    status: true,
    updatedAt: true,
    lineItems: { select: { quantity: true, unitPriceCents: true, tag: true } },
  },
} as const;

// Moves a deal forward when paperwork goes out. Never moves it backwards
// and never touches a deal that is already Won or Lost, except that a
// signed contract always wins the deal — that is the one event that
// outranks whatever the stage was.
export async function advanceDealStage(
  dealId: string | null | undefined,
  organizationId: string,
  target: DealStageValue,
) {
  if (!dealId) return;
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
    select: { stage: true },
  });
  if (!deal) return;

  const current = DEAL_STAGES.indexOf(deal.stage);
  const next = DEAL_STAGES.indexOf(target);
  const closed = deal.stage === "WON" || deal.stage === "LOST";

  const shouldMove = target === "WON" ? deal.stage !== "WON" : !closed && next > current;
  if (!shouldMove) return;

  await prisma.deal.updateMany({
    where: { id: dealId, organizationId },
    data: { stage: target },
  });
}
