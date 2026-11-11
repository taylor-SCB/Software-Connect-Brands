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
    data: { status: "ACCEPTED", respondedAt },
  });
  if (accepted.count === 0) return;
  await syncQuoteEvents(organizationId, quoteId, actorId);
  revalidatePath(`/dashboard/quotes/${quoteId}`);
  revalidatePath("/dashboard/quotes");
}
