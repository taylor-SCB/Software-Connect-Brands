"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { getTimeZone } from "@/lib/organization";
import { todayIso } from "@/lib/payments";
import { isRealDay } from "@/lib/calendar";
import { readMeetingNotes, type NotesProposal } from "@/lib/meeting-notes";
import { logEventDone, scheduleActivityEvent } from "@/lib/calendar-auto";
import { logTouchNow } from "@/lib/touch";
import { advanceContact } from "@/lib/status";
import { resolveDeal } from "@/lib/deal-picker-server";
import { publicToken } from "@/lib/tokens";
import { tagHasUnits, unitAllowedForTag } from "@/lib/constants";

// Meeting notes (Oct 2, 2026): read, then apply. Reading costs one AI draft
// and changes nothing. Applying does only what was ticked.

export async function readNotesAction(input: { contactId: string; notes: string }): Promise<{ error?: string; proposal?: NotesProposal }> {
  const { organizationId, userId } = await requireSession();
  const notes = String(input.notes ?? "").trim();
  if (notes.length < 8) return { error: "Type or dictate a line or two about the meeting first" };
  if (notes.length > 6000) return { error: "That's a lot of notes. Keep it under about a page." };
  const timeZone = await getTimeZone();
  const result = await readMeetingNotes({ organizationId, userId, timeZone, contactId: String(input.contactId), notes });
  if (!result.ok) return { error: result.error };
  return { proposal: result.data };
}

const applySchema = z.object({
  contactId: z.string().trim().min(1),
  // The calendar entry the notes are about, when they came from ticking it done.
  eventId: z.string().trim().optional(),
  notes: z.string().trim().max(6000),
  log: z.object({ summary: z.string().trim().min(1, "The line for their history can't be empty").max(2000) }).nullable(),
  markHeld: z.boolean(),
  followUp: z.object({ on: z.string(), what: z.string().trim().min(1).max(200) }).nullable(),
  quote: z
    .object({
      title: z.string().trim().min(1, "Give the quote a title").max(160),
      lines: z
        .array(z.object({ productId: z.string().trim().min(1), quantity: z.number().positive().max(1_000_000), note: z.string().max(200) }))
        .max(100),
    })
    .nullable(),
});

export type ApplyNotesInput = z.input<typeof applySchema>;

export async function applyNotesAction(input: ApplyNotesInput): Promise<{ error?: string; done?: string[]; quoteId?: string }> {
  const { organizationId, userId } = await requireSession();
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check what's ticked" };
  const data = parsed.data;

  const contact = await prisma.contact.findFirst({
    where: { id: data.contactId, organizationId },
    select: { id: true, name: true, companyId: true },
  });
  if (!contact) return { error: "Contact not found" };
  const timeZone = await getTimeZone();
  const today = todayIso(timeZone);
  if (data.followUp && (!isRealDay(data.followUp.on) || data.followUp.on < today)) return { error: "Pick a follow-up day from today on" };

  // Everything checked before anything is written, so a bad product id
  // can't leave the meeting logged and the quote missing.
  const productIds = data.quote ? [...new Set(data.quote.lines.map((line) => line.productId))] : [];
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { organizationId, id: { in: productIds } },
        select: { id: true, name: true, description: true, unitPriceCents: true, defaultTag: true, unitOfMeasure: true, serviceType: true },
      })
    : [];
  const byId = new Map(products.map((product) => [product.id, product]));
  if (data.quote && data.quote.lines.some((line) => !byId.has(line.productId))) {
    return { error: "One of those products is no longer in your catalog. Read the notes again." };
  }

  const done: string[] = [];
  const who = { organizationId, userId };
  const body = data.log ? (data.notes && data.notes !== data.log.summary ? `${data.log.summary}\n\nNotes as typed: ${data.notes}` : data.log.summary) : "";

  if (data.log) {
    let logged = false;
    if (data.eventId) {
      const event = await prisma.calendarEvent.findFirst({
        where: { id: data.eventId, organizationId },
        select: { id: true, doneAt: true, activityId: true },
      });
      if (event && !event.doneAt && !event.activityId) {
        const result = await logEventDone({ organizationId, userId, eventId: event.id, activityType: "MEETING", note: body });
        logged = !("error" in result);
      }
    }
    if (!logged) await logTouchNow({ organizationId, userId, contactId: contact.id, type: "MEETING", body });
    done.push("Logged the meeting");
  }

  if (data.markHeld) {
    // Held means it was set, too: a meeting nobody booked ahead still
    // passes through Meeting Set on the way, the same day.
    const now = new Date();
    await advanceContact(who, contact.id, "MEETING_SET", { on: now });
    await advanceContact(who, contact.id, "MEETING_COMPLETED", { on: now, auto: false });
    done.push("Marked the meeting held");
  }

  if (data.followUp) {
    await scheduleActivityEvent({
      organizationId,
      userId,
      type: "PHONE_CALL",
      body: data.followUp.what,
      startOn: data.followUp.on,
      startTime: null,
      contactIds: [contact.id],
      companyId: contact.companyId,
      primaryName: contact.name,
    });
    done.push("Put the follow-up on the calendar");
  }

  let quoteId: string | undefined;
  if (data.quote) {
    const deal = await resolveDeal({ dealId: null, dealTitle: data.quote.title, contactId: contact.id, organizationId, ownerId: userId });
    if (!deal) return { error: "Couldn't make a deal for the quote", done };
    const organization = await prisma.organization.update({
      where: { id: organizationId },
      data: { nextQuoteNumber: { increment: 1 } },
      select: { nextQuoteNumber: true },
    });
    const quote = await prisma.quote.create({
      data: {
        organizationId,
        contactId: contact.id,
        dealId: deal.id,
        title: data.quote.title,
        number: organization.nextQuoteNumber - 1,
        publicToken: publicToken(),
        leadSalesRepId: userId,
        // Every price is the catalog's own, copied as a quote line always is.
        lineItems: {
          create: data.quote.lines.map((line, position) => {
            const product = byId.get(line.productId)!;
            const unit =
              product.unitOfMeasure && tagHasUnits(product.defaultTag) && unitAllowedForTag(product.unitOfMeasure, product.defaultTag)
                ? product.unitOfMeasure
                : null;
            return {
              productId: product.id,
              name: product.name,
              description: product.description,
              projectNotes: line.note,
              quantity: line.quantity,
              unitPriceCents: product.unitPriceCents,
              tag: product.defaultTag,
              unitOfMeasure: unit,
              serviceType: product.serviceType,
              position,
            };
          }),
        },
      },
      select: { id: true, number: true },
    });
    quoteId = quote.id;
    done.push(`Drafted QUO-${quote.number}`);
    revalidatePath("/dashboard/quotes");
    revalidatePath("/dashboard/deals");
  }

  revalidatePath(`/dashboard/contacts/${contact.id}`);
  if (contact.companyId) revalidatePath(`/dashboard/companies/${contact.companyId}`);
  revalidatePath("/dashboard/calendar");
  revalidatePath("/dashboard/call-list");
  return { done, quoteId };
}
