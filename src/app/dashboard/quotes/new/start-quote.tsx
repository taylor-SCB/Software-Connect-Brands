"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startQuoteForDeal } from "../actions";

// Build Quote lands here with the deal picked: the quote is started on the
// spot, titled after the deal, and the page moves straight on to it. The
// setup form is one link away for anyone who wants to name it first.
export function StartQuote({
  dealId,
  contactId,
  dealTitle,
  draftFromMeeting,
  formHref,
}: {
  dealId: string;
  contactId: string | null;
  dealTitle: string;
  draftFromMeeting: boolean;
  formHref: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startQuoteForDeal({ dealId, contactId }).then(
      (result) => {
        if ("error" in result) {
          setError(result.error);
          return;
        }
        router.replace(`/dashboard/quotes/${result.quoteId}${draftFromMeeting ? "?draft=meeting" : ""}`);
      },
      () => setError("Couldn't start the quote — check your connection and try again."),
    );
  }, [dealId, contactId, draftFromMeeting, router]);

  return (
    <div className="p-5" data-testid="start-quote">
      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>
      ) : (
        <p className="muted text-sm" role="status">
          Starting a quote for <span className="font-semibold text-[var(--text)]">{dealTitle}</span>…
        </p>
      )}
      <p className="faint mt-2 text-xs">
        <Link href={formHref} className="link">Set it up by hand instead</Link>
      </p>
    </div>
  );
}
