import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { syncQuoteEvents } from "@/lib/calendar-auto";

// A customer signing a contract made from a quote has said yes to that
// quote (UX review, Nov 10, 2026): it becomes Accepted, so the won deal
// keeps its value (pickPrimaryQuote pins an accepted quote; before this a
// newer $0 draft on the deal became the value), it stops counting as out
// with the customer, and its open follow-up and due date come off the
// calendar and Coming up. Only a quote still Sent is moved: one already
// answered, or pulled back to Draft, is left as it is.
//
// Used by signing, Mark as signed and Award without paperwork. Kept out
// of the "use server" files so it can't be called from a browser with
// someone else's workspace id.
export async function acceptSourceQuote(
  organizationId: string,
  quoteId: string | null,
  respondedAt: Date,
  actorId: string | null,
) {
  if (!quoteId) return;
  const accepted = await prisma.quote.updateMany({
    where: { id: quoteId, organizationId, status: "SENT" },
    // Accepted by signing or by the team, not online: no customer name.
    data: { status: "ACCEPTED", respondedAt, acceptedByName: null },
  });
  if (accepted.count === 0) return;
  await syncQuoteEvents(organizationId, quoteId, actorId);
  revalidatePath(`/dashboard/quotes/${quoteId}`);
  revalidatePath("/dashboard/quotes");
}

// Past its Valid until day in the workspace's calendar (audit, Nov 11,
// 2026). Valid until is saved as noon UTC on the day picked, so its UTC
// date is the day; it is good through the end of that day where the
// business is.
export function quoteExpired(validUntil: Date | null, timeZone: string | null | undefined, now: Date = new Date()) {
  if (!validUntil) return false;
  const today = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timeZone || "America/Chicago" }).format(now);
  return validUntil.toISOString().slice(0, 10) < today;
}
