// One-off clean-up (UX review, Nov 10, 2026). Until then, signing a
// customer's contract left the quote it came from on Sent: it still
// counted in "$X out with customers" and Quotes out, its "Quote follow up"
// sat in Coming up and on the calendar, and a newer $0 draft on the same
// deal could become the won deal's value. Signing now accepts that quote
// itself (acceptSourceQuote in src/lib/quote-accept.ts);
// this does the same for contracts signed before the fix.
//
// For every signed customer contract (not a purchase order) whose quote
// is still Sent: the quote becomes Accepted, dated the day the contract
// was signed, and its open follow-up and due entries come off the
// calendar. A quote that is Draft, Accepted or Declined is left alone,
// and running it twice changes nothing the second time.
//
//   npx tsx scripts/accept-signed-quotes.ts
//   npx tsx scripts/accept-signed-quotes.ts --check    (list them, change nothing)
//   npx tsx scripts/accept-signed-quotes.ts --org=<id> (one workspace only)

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { syncQuoteEvents } from "../src/lib/calendar-auto";

async function main() {
  const checkOnly = process.argv.includes("--check");
  const organizationId = process.argv.find((arg) => arg.startsWith("--org="))?.slice("--org=".length) || undefined;
  // Oldest signature first, so a quote split into two signed contracts is
  // dated by the first one.
  const contracts = await prisma.contract.findMany({
    where: {
      organizationId,
      status: "SIGNED",
      payable: false,
      quoteId: { not: null },
      quote: { status: "SENT" },
    },
    orderBy: [{ signedAt: "asc" }, { createdAt: "asc" }],
    select: {
      number: true,
      organizationId: true,
      quoteId: true,
      signedAt: true,
      updatedAt: true,
      quote: { select: { number: true, contact: { select: { name: true } } } },
    },
  });

  let accepted = 0;
  const seen = new Set<string>();
  for (const contract of contracts) {
    const quoteId = contract.quoteId!;
    if (seen.has(quoteId)) continue;
    seen.add(quoteId);
    const respondedAt = contract.signedAt ?? contract.updatedAt;
    const label = `QUO-${contract.quote?.number} (${contract.quote?.contact.name}), signed on CON-${contract.number} ${respondedAt.toISOString().slice(0, 10)}`;
    if (checkOnly) {
      console.log(`would accept ${label}`);
      accepted += 1;
      continue;
    }
    // Only while it is still Sent, the same guard signing uses.
    const result = await prisma.quote.updateMany({
      where: { id: quoteId, organizationId: contract.organizationId, status: "SENT" },
      data: { status: "ACCEPTED", respondedAt },
    });
    if (result.count === 0) continue;
    await syncQuoteEvents(contract.organizationId, quoteId, null);
    console.log(`accepted ${label}`);
    accepted += 1;
  }

  console.log(
    accepted === 0
      ? "Every signed contract's quote is already answered."
      : `${accepted} ${accepted === 1 ? "quote" : "quotes"} ${checkOnly ? "would be accepted" : "accepted"}.`,
  );
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
