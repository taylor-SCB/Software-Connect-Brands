"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseForm, type ActionState } from "@/lib/forms";
import { publicToken } from "@/lib/tokens";
import { LINE_ITEM_TAGS, QUOTE_TEMPLATES } from "@/lib/constants";
import { resolveDeal } from "@/lib/deal-picker-server";
import { advanceDealStage } from "@/lib/deals";

const idSchema = z.string().trim().min(1, "Missing record reference");

// Reserves the next human-readable number for this tenant. The atomic
// increment is what stops two people creating QUO-1004 at once.
async function nextQuoteNumber(organizationId: string) {
  const organization = await prisma.organization.update({
    where: { id: organizationId },
    data: { nextQuoteNumber: { increment: 1 } },
    select: { nextQuoteNumber: true },
  });
  return organization.nextQuoteNumber - 1;
}

export async function createQuote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = parseForm(
    z.object({
      contactId: idSchema,
      dealId: z.string().trim().optional(),
      dealTitle: z.string().trim().max(160).optional(),
      title: z.string().trim().min(1, "Give the quote a title").max(160),
      template: z.enum(QUOTE_TEMPLATES),
    }),
    {
      contactId: formData.get("contactId"),
      dealId: formData.get("dealId") ?? undefined,
      dealTitle: formData.get("dealTitle") ?? undefined,
      title: formData.get("title"),
      template: formData.get("template"),
    },
  );
  if (!parsed.ok) return { error: parsed.error };

  const contact = await prisma.contact.findFirst({
    where: { id: parsed.data.contactId, organizationId },
    select: { id: true },
  });
  if (!contact) return { error: "Pick a contact for this quote" };

  const deal = await resolveDeal({
    dealId: parsed.data.dealId || null,
    dealTitle: parsed.data.dealTitle || null,
    contactId: contact.id,
    organizationId,
  });
  if (!deal) return { error: "Pick a deal for this quote, or add a new one" };

  const quote = await prisma.quote.create({
    data: {
      organizationId,
      contactId: contact.id,
      dealId: deal.id,
      title: parsed.data.title,
      template: parsed.data.template,
      number: await nextQuoteNumber(organizationId),
      publicToken: publicToken(),
    },
  });

  revalidatePath("/dashboard/quotes");
  revalidatePath("/dashboard/deals");
  revalidatePath(`/dashboard/contacts/${contact.id}`);
  redirect(`/dashboard/quotes/${quote.id}`);
}

export async function updateQuoteMeta(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = parseForm(
    z.object({
      quoteId: idSchema,
      title: z.string().trim().min(1, "Give the quote a title").max(160),
      template: z.enum(QUOTE_TEMPLATES),
      introNote: z.string().trim().max(4000).optional(),
      terms: z.string().trim().max(4000).optional(),
      validUntil: z.string().trim().optional(),
    }),
    {
      quoteId: formData.get("quoteId"),
      title: formData.get("title"),
      template: formData.get("template"),
      introNote: formData.get("introNote") ?? undefined,
      terms: formData.get("terms") ?? undefined,
      validUntil: formData.get("validUntil") ?? undefined,
    },
  );
  if (!parsed.ok) return { error: parsed.error };

  // A date input gives "2026-09-30"; parse as UTC noon so the displayed
  // day can't drift backwards for viewers behind UTC.
  const validUntil = parsed.data.validUntil
    ? new Date(`${parsed.data.validUntil}T12:00:00.000Z`)
    : null;
  if (validUntil && Number.isNaN(validUntil.getTime())) {
    return { error: "That expiry date isn't valid" };
  }

  const result = await prisma.quote.updateMany({
    where: { id: parsed.data.quoteId, organizationId },
    data: {
      title: parsed.data.title,
      template: parsed.data.template,
      introNote: parsed.data.introNote ?? "",
      terms: parsed.data.terms ?? "",
      validUntil,
    },
  });
  if (result.count === 0) return { error: "Quote not found" };

  revalidatePath(`/dashboard/quotes/${parsed.data.quoteId}`);
  revalidatePath("/dashboard/quotes");
  return { success: "Quote details saved" };
}

const lineItemSchema = z.object({
  // Present for a row that already exists; the save keeps that row so a
  // contract split off it stays linked and its cancelled mark survives.
  id: z.string().trim().nullable().optional(),
  productId: z.string().trim().nullable().optional(),
  name: z.string().trim().min(1, "Every line needs a product name").max(200),
  description: z.string().max(2000).optional(),
  projectNotes: z.string().max(2000).optional(),
  quantity: z.number().finite().min(0, "Quantity can't be negative").max(1_000_000),
  unitPriceCents: z.number().int().min(-100_000_000).max(100_000_000),
  // Enforced here as well as in the UI: the tag totals grid only
  // reconciles with the quote total if every line carries a tag.
  tag: z.enum(LINE_ITEM_TAGS, { message: "Every line needs a tag" }),
});

export type LineItemInput = z.infer<typeof lineItemSchema>;

export async function saveLineItems(
  quoteId: string,
  items: LineItemInput[],
): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const id = idSchema.safeParse(quoteId);
  if (!id.success) return { error: "Missing quote reference" };

  const parsed = z.array(lineItemSchema).max(200).safeParse(items);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the line items" };
  }

  const quote = await prisma.quote.findFirst({
    where: { id: id.data, organizationId },
    select: { id: true },
  });
  if (!quote) return { error: "Quote not found" };

  // Products referenced by a line must belong to this tenant; anything
  // else is stored as a free-text line rather than trusted.
  const productIds = parsed.data
    .map((item) => item.productId)
    .filter((value): value is string => Boolean(value));
  const ownedProducts = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds }, organizationId },
        select: { id: true },
      })
    : [];
  const ownedIds = new Set(ownedProducts.map((product) => product.id));

  // The editor's order is authoritative. Rows it still has are updated
  // in place (their ids matter: the deal tracker's contracts point at
  // them), rows it dropped are deleted, new ones are created.
  const existing = await prisma.quoteLineItem.findMany({
    where: { quoteId: quote.id },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((item) => item.id));
  const keptIds = new Set(
    parsed.data.map((item) => item.id).filter((id): id is string => Boolean(id) && existingIds.has(id as string)),
  );

  await prisma.$transaction([
    prisma.quoteLineItem.deleteMany({
      where: { quoteId: quote.id, id: { notIn: [...keptIds] } },
    }),
    ...parsed.data.map((item, index) => {
      const data = {
        productId: item.productId && ownedIds.has(item.productId) ? item.productId : null,
        name: item.name,
        description: item.description ?? "",
        projectNotes: item.projectNotes ?? "",
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        tag: item.tag,
        position: index,
      };
      return item.id && keptIds.has(item.id)
        ? prisma.quoteLineItem.update({ where: { id: item.id }, data })
        : prisma.quoteLineItem.create({ data: { quoteId: quote.id, ...data } });
    }),
    prisma.quote.update({ where: { id: quote.id }, data: { updatedAt: new Date() } }),
  ]);

  revalidatePath(`/dashboard/quotes/${quote.id}`);
  revalidatePath("/dashboard/quotes");
  return { success: "Line items saved" };
}

export async function setQuoteStatus(formData: FormData) {
  const { organizationId } = await requireSession();

  const parsed = z
    .object({
      quoteId: idSchema,
      status: z.enum(["DRAFT", "SENT", "ACCEPTED", "DECLINED"]),
    })
    .safeParse({
      quoteId: formData.get("quoteId"),
      status: formData.get("status"),
    });
  if (!parsed.success) return;

  const { quoteId, status } = parsed.data;
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, organizationId },
    select: { dealId: true, contactId: true },
  });
  if (!quote) return;

  await prisma.quote.updateMany({
    where: { id: quoteId, organizationId },
    data: {
      status,
      sentAt: status === "SENT" ? new Date() : undefined,
      respondedAt:
        status === "ACCEPTED" || status === "DECLINED" ? new Date() : undefined,
    },
  });

  // Sending a quote moves its deal along the pipeline.
  if (status === "SENT") await advanceDealStage(quote.dealId, organizationId, "QUOTE_SENT");

  revalidatePath(`/dashboard/quotes/${quoteId}`);
  revalidatePath("/dashboard/quotes");
  revalidatePath("/dashboard/deals");
  revalidatePath(`/dashboard/contacts/${quote.contactId}`);
  revalidatePath("/dashboard");
}

export async function deleteQuote(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = idSchema.safeParse(formData.get("quoteId"));
  if (!id.success) return;

  await prisma.quote.deleteMany({ where: { id: id.data, organizationId } });
  revalidatePath("/dashboard/quotes");
  redirect("/dashboard/quotes");
}
