-- Catch-up (UX review, Nov 10, 2026; was scripts/accept-signed-quotes.ts).
-- Until then, signing a customer's contract left the quote it came from on
-- Sent: it still counted as out with the customer, its "Quote follow up"
-- and "Quote due" sat open on the calendar, and a newer $0 draft on the
-- same deal could become the won deal's value. Signing now accepts the
-- quote itself (acceptSourceQuote in src/lib/quote-accept.ts); this does
-- the same, once, for contracts signed before that.
--
-- For every signed customer contract (not a purchase order) whose quote,
-- in the same workspace, is still Sent: the quote becomes Accepted, dated
-- by its earliest signed contract, and its open auto-written follow-up and
-- due entries come off the calendar (what syncQuoteEvents does for a quote
-- that is no longer Sent). A quote that is Draft, Accepted or Declined is
-- left alone, so running this twice changes nothing the second time.

WITH signed AS (
  SELECT c."organizationId", c."quoteId", MIN(COALESCE(c."signedAt", c."updatedAt")) AS "signedOn"
  FROM "Contract" c
  WHERE c."status" = 'SIGNED'
    AND c."payable" = false
    AND c."quoteId" IS NOT NULL
  GROUP BY c."organizationId", c."quoteId"
),
accepted AS (
  UPDATE "Quote" q
  SET "status" = 'ACCEPTED',
      "respondedAt" = s."signedOn",
      "updatedAt" = now()
  FROM signed s
  WHERE q."id" = s."quoteId"
    AND q."organizationId" = s."organizationId"
    AND q."status" = 'SENT'
  RETURNING q."id", q."organizationId"
)
DELETE FROM "CalendarEvent" e
USING accepted a
WHERE e."quoteId" = a."id"
  AND e."organizationId" = a."organizationId"
  AND e."auto" = true
  AND e."doneAt" IS NULL
  AND e."type" IN ('Quote follow up', 'Quote due');
