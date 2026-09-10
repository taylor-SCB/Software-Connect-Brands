"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { DEAL_STAGE_LABELS, type DealStageValue } from "@/lib/constants";

// The deal (and, when a deal has more than one, the quote) the tracker
// shows. Changing either changes the address, so the page can be
// bookmarked and the back button works.
export function TrackerPicker({
  basePath,
  deals,
  dealId,
  quotes,
  quoteId,
}: {
  basePath: string;
  deals: { id: string; title: string; stage: string; who: string; quotes: number; contracts: number }[];
  dealId: string;
  quotes: { id: string; number: number; title: string; status: string }[];
  quoteId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function go(nextDeal: string, nextQuote?: string) {
    const params = new URLSearchParams();
    if (nextDeal) params.set("dealId", nextDeal);
    if (nextQuote) params.set("quoteId", nextQuote);
    startTransition(() => router.push(`${basePath}${params.size ? `?${params}` : ""}`));
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="w-full sm:w-96">
        <label className="label" htmlFor="trackerDeal">
          Deal
        </label>
        <select
          id="trackerDeal"
          className="select"
          value={dealId}
          disabled={pending}
          onChange={(event) => go(event.target.value)}
        >
          <option value="">Select a deal…</option>
          {deals.map((deal) => (
            <option key={deal.id} value={deal.id}>
              {deal.title} — {deal.who} · {DEAL_STAGE_LABELS[deal.stage as DealStageValue] ?? deal.stage}
              {deal.contracts ? ` · ${deal.contracts} ${deal.contracts === 1 ? "contract" : "contracts"}` : ""}
            </option>
          ))}
        </select>
      </div>
      {dealId && quotes.length > 1 && (
        <div className="w-full sm:w-72">
          <label className="label" htmlFor="trackerQuote">
            Quote
          </label>
          <select
            id="trackerQuote"
            className="select"
            value={quoteId}
            disabled={pending}
            onChange={(event) => go(dealId, event.target.value)}
          >
            {quotes.map((quote) => (
              <option key={quote.id} value={quote.id}>
                QUO-{quote.number} · {quote.title} · {quote.status.charAt(0) + quote.status.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
