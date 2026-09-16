"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseForm, keepFields, type ActionState } from "@/lib/forms";
import { publicToken } from "@/lib/tokens";
import {
  LINE_ITEM_TAGS,
  QUOTE_TEMPLATES,
  UNITS_OF_MEASURE,
  SOFTWARE_RATES,
  tagHasUnits,
  unitAllowedForTag,
} from "@/lib/constants";
import { resolveDeal } from "@/lib/deal-picker-server";
import { advanceDealStage } from "@/lib/deals";
import { computeSchedule, dateToIso, isoToDate } from "@/lib/payments";
import { computeQuoteTotals } from "@/lib/quote-math";

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
  const { organizationId, userId } = await requireSession();

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
      // Whoever wrote it owns it until someone says otherwise, so a
      // one-person workspace never has to fill this in.
      leadSalesRepId: userId,
    },
  });

  revalidatePath("/dashboard/quotes");
  revalidatePath("/dashboard/deals");
  revalidatePath(`/dashboard/contacts/${contact.id}`);
  redirect(`/dashboard/quotes/${quote.id}`);
}

const QUOTE_META_FIELDS = ["title", "template", "introNote", "terms", "validUntil"] as const;

export async function updateQuoteMeta(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  // React empties a form whose action is a server function, including when
  // that function refuses, so what was typed has to be handed back with
  // every error. The three people fields are held in the form's own state
  // instead: this can only carry one value per field, so it would lose a
  // multi-select and would put a deliberately cleared name back.
  const kept = keepFields(formData, QUOTE_META_FIELDS);

  const parsed = parseForm(
    z.object({
      quoteId: idSchema,
      title: z.string().trim().min(1, "Give the quote a title").max(160),
      template: z.enum(QUOTE_TEMPLATES),
      introNote: z.string().trim().max(4000).optional(),
      terms: z.string().trim().max(4000).optional(),
      validUntil: z.string().trim().optional(),
      leadSalesRepId: z.string().trim().optional(),
      contractSignerId: z.string().trim().optional(),
    }),
    {
      quoteId: formData.get("quoteId"),
      title: formData.get("title"),
      template: formData.get("template"),
      introNote: formData.get("introNote") ?? undefined,
      terms: formData.get("terms") ?? undefined,
      validUntil: formData.get("validUntil") ?? undefined,
      leadSalesRepId: formData.get("leadSalesRepId") ?? undefined,
      contractSignerId: formData.get("contractSignerId") ?? undefined,
    },
  );
  if (!parsed.ok) return { error: parsed.error, kept };

  // Read outside parseForm, which takes one value per field.
  const teamUserIds = formData
    .getAll("teamUserIds")
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .slice(0, 200);

  // A date input gives "2026-09-30"; parse as UTC noon so the displayed
  // day can't drift backwards for viewers behind UTC.
  const validUntil = parsed.data.validUntil
    ? new Date(`${parsed.data.validUntil}T12:00:00.000Z`)
    : null;
  if (validUntil && Number.isNaN(validUntil.getTime())) {
    return { error: "That expiry date isn't valid", kept };
  }

  // These arrive as hidden inputs, so anyone could post any id. Keep only
  // the ones that really belong to this workspace; a name that doesn't
  // survive becomes nobody rather than an error, the way a line's product
  // and supplier already behave.
  const wanted = [parsed.data.leadSalesRepId, parsed.data.contractSignerId, ...teamUserIds].filter(
    (value): value is string => Boolean(value),
  );
  const owned = wanted.length
    ? new Set(
        (
          await prisma.user.findMany({
            where: { organizationId, id: { in: wanted } },
            select: { id: true },
          })
        ).map((user) => user.id),
      )
    : new Set<string>();
  const ownedOrNull = (id: string | undefined) => (id && owned.has(id) ? id : null);

  // All three are plain columns, so this stays an updateMany with the
  // workspace in the WHERE clause. A join table would force a bare update
  // by id, which drops the tenant check.
  const result = await prisma.quote.updateMany({
    where: { id: parsed.data.quoteId, organizationId },
    data: {
      title: parsed.data.title,
      template: parsed.data.template,
      introNote: parsed.data.introNote ?? "",
      terms: parsed.data.terms ?? "",
      validUntil,
      leadSalesRepId: ownedOrNull(parsed.data.leadSalesRepId),
      contractSignerId: ownedOrNull(parsed.data.contractSignerId),
      teamUserIds: [...new Set(teamUserIds.filter((id) => owned.has(id)))],
    },
  });
  if (result.count === 0) return { error: "Quote not found", kept };

  revalidatePath(`/dashboard/quotes/${parsed.data.quoteId}`);
  revalidatePath("/dashboard/quotes");
  return { success: "Quote details saved" };
}

const lineItemSchema = z.object({
  // Present for a row that already exists; the save keeps that row so a
  // contract split off it stays linked and its cancelled mark survives.
  id: z.string().trim().nullable().optional(),
  // The editor's own handle for the row, echoed back untouched so it can
  // match a created row's new id to the right row. Matching on array
  // position instead would write the wrong id onto a row whenever one is
  // added or deleted while the save is in flight.
  uid: z.string().trim().max(60).nullable().optional(),
  productId: z.string().trim().nullable().optional(),
  name: z.string().trim().min(1, "Every line needs a product name").max(200),
  description: z.string().max(2000).optional(),
  projectNotes: z.string().max(2000).optional(),
  quantity: z.number().finite().min(0, "Quantity can't be negative").max(1_000_000),
  unitPriceCents: z.number().int().min(-100_000_000).max(100_000_000),
  // Enforced here as well as in the UI: the tag totals grid only
  // reconciles with the quote total if every line carries a tag.
  tag: z.enum(LINE_ITEM_TAGS, { message: "Every line needs a tag" }),
  // The kind of work the row is, when the quote is split that way.
  serviceType: z.string().trim().max(60).nullable().optional(),
  // Who we buy the line from. Internal — never rendered for a customer.
  supplierCompanyId: z.string().trim().nullable().optional(),
  unitOfMeasure: z.enum(UNITS_OF_MEASURE).nullable().optional(),
  softwareRate: z.enum(SOFTWARE_RATES).nullable().optional(),
  softwareTermMonths: z.number().int().min(1).max(1200).nullable().optional(),
  // Whether to put a hand-typed line into the catalog as well.
  saveAsProduct: z.boolean().optional(),
});

export type LineItemInput = z.infer<typeof lineItemSchema>;

// A quote line stores a term in plain months; a Product counts periods of
// whatever its rate says. "Pay in full" is one period however long it runs.
function softwareTermPeriods(rate: string, months: number | null | undefined): number | null {
  if (!months || months <= 0) return null;
  if (rate === "PER_TERM") return 1;
  const periods = rate === "PER_YEAR" ? Math.round(months / 12) : months;
  return periods >= 1 && periods <= 1200 ? periods : null;
}

// What a saved row came back as. The editor folds these into its state so
// a row created by this save carries its stored id from now on; without
// that the next save sees no id, deletes the row and creates a new one —
// which silently severs any contract line pointing at it.
export type SavedLine = { uid: string | null; id: string; productId: string | null };

export async function saveLineItems(
  quoteId: string,
  items: LineItemInput[],
): Promise<ActionState & { lines?: SavedLine[] }> {
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

  // Same footing for suppliers: a company id from another tenant is
  // downgraded to nothing rather than trusted or refused. Refusing would
  // make a legitimate save fail because of an unrelated deletion, which is
  // how the product check already behaves.
  const supplierIds = parsed.data
    .map((item) => item.supplierCompanyId)
    .filter((value): value is string => Boolean(value));
  const ownedSuppliers = supplierIds.length
    ? await prisma.company.findMany({
        where: { id: { in: supplierIds }, organizationId },
        select: { id: true },
      })
    : [];
  const ownedSupplierIds = new Set(ownedSuppliers.map((company) => company.id));

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

  // Interactive rather than the array form: the array form builds every
  // promise before the transaction opens, so a row cannot use an id
  // created earlier in the same save.
  let createdProducts = 0;

  const lines = await prisma.$transaction(async (tx) => {
    await tx.quoteLineItem.deleteMany({
      where: { quoteId: quote.id, id: { notIn: [...keptIds] } },
    });

    // Names claimed by a product made earlier in this same save, so two
    // identical typed lines become one catalog entry rather than two.
    const madeThisSave = new Map<string, string>();

    const saved: SavedLine[] = [];
    for (const [index, item] of parsed.data.entries()) {
      // A unit that doesn't belong to the row's tag is dropped rather than
      // stored: the Products form enforces the same pairing and would
      // refuse to re-save a row carrying a mismatched one.
      const unit =
        item.unitOfMeasure && tagHasUnits(item.tag) && unitAllowedForTag(item.unitOfMeasure, item.tag)
          ? item.unitOfMeasure
          : null;
      const isSoftware = item.tag === "SOFTWARE";

      let productId = item.productId && ownedIds.has(item.productId) ? item.productId : null;

      // "Save as product?" — ticked by default on a line typed by hand.
      if (!productId && item.saveAsProduct && item.name) {
        // Product.name allows 160 where a line allows 200, so a long line
        // would fail validation the moment anyone opened it in Products.
        const productName = item.name.slice(0, 160);
        const key = productName.toLowerCase();

        const already = madeThisSave.get(key);
        if (already) {
          productId = already;
        } else {
          // Product has no unique constraint on name, so without this a
          // re-save would make a twin every time.
          //
          // Compared with lower() rather than Prisma's insensitive equals:
          // that compiles to ILIKE, which reads % and _ in the name as
          // wildcards — so a line called "3% Fee" would silently attach
          // itself to an existing "3% Card Processing Fee".
          const existing = await tx.$queryRaw<{ id: string }[]>`
            SELECT "id" FROM "Product"
             WHERE "organizationId" = ${organizationId}
               AND lower("name") = lower(${productName})
             ORDER BY "createdAt" ASC
             LIMIT 1`;
          if (existing.length > 0) {
            productId = existing[0].id;
          } else {
            const created = await tx.product.create({
              data: {
                organizationId,
                name: productName,
                // A discount row is legitimately negative on a quote, but a
                // negative price in the catalog is not.
                unitPriceCents: Math.max(0, item.unitPriceCents),
                defaultTag: item.tag,
                serviceType: item.serviceType || null,
                unitOfMeasure: unit,
                // The catalog only shows a rate and term beside a software
                // UNIT, so writing a rate without one makes it invisible
                // there and the product's own next save wipes it. Carry
                // both or neither. The line stores plain months; the
                // catalog counts periods of whatever the rate says.
                ...(isSoftware && unit && item.softwareRate
                  ? {
                      softwareRate: item.softwareRate,
                      softwareTerm: softwareTermPeriods(item.softwareRate, item.softwareTermMonths),
                    }
                  : {}),
                active: true,
              },
              select: { id: true },
            });
            productId = created.id;
            createdProducts += 1;
          }
          madeThisSave.set(key, productId);
        }
      }

      const data = {
        productId,
        name: item.name,
        description: item.description ?? "",
        projectNotes: item.projectNotes ?? "",
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        tag: item.tag,
        serviceType: item.serviceType || null,
        supplierCompanyId:
          item.supplierCompanyId && ownedSupplierIds.has(item.supplierCompanyId)
            ? item.supplierCompanyId
            : null,
        unitOfMeasure: unit,
        softwareRate: isSoftware ? item.softwareRate ?? null : null,
        softwareTermMonths: isSoftware ? item.softwareTermMonths ?? null : null,
        position: index,
      };
      const select = { id: true, productId: true } as const;
      const row =
        item.id && keptIds.has(item.id)
          ? await tx.quoteLineItem.update({ where: { id: item.id }, data, select })
          : await tx.quoteLineItem.create({ data: { quoteId: quote.id, ...data }, select });
      saved.push({ uid: item.uid ?? null, id: row.id, productId: row.productId });
    }

    // The payment rows are priced against the lines, so changing the lines
    // has to re-price them in the same breath. Without this the stored
    // amounts stay frozen while the quote total moves, and the customer's
    // copy prints a total and a payment schedule that disagree — the
    // sender never sees it, because their own table recomputes live.
    const payments = await tx.quotePayment.findMany({
      where: { quoteId: quote.id },
      orderBy: { position: "asc" },
      select: { id: true, label: true, kind: true, percent: true, amountCents: true, dueOn: true, terms: true },
    });
    if (payments.length > 0) {
      const totalCents = computeQuoteTotals(
        parsed.data.map((item) => ({
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          tag: item.tag,
        })),
      ).totalCents;
      const repriced = computeSchedule(
        payments.map((row) => ({
          label: row.label,
          kind: row.kind,
          percent: row.percent,
          // A fixed amount is a number the sender typed; it stays put.
          fixedCents: row.kind === "FIXED" ? row.amountCents : null,
          dueOn: dateToIso(row.dueOn),
          terms: row.terms,
        })),
        totalCents,
      );
      for (const [index, row] of repriced.rows.entries()) {
        const stored = payments[index];
        if (!stored || stored.amountCents === row.amountCents) continue;
        await tx.quotePayment.update({
          where: { id: stored.id },
          data: { amountCents: row.amountCents },
        });
      }
    }

    await tx.quote.update({ where: { id: quote.id }, data: { updatedAt: new Date() } });
    return saved;
  });

  revalidatePath(`/dashboard/quotes/${quote.id}`);
  revalidatePath("/dashboard/quotes");
  if (createdProducts > 0) revalidatePath("/dashboard/products");
  return { success: "Line items saved", lines };
}

/* ------------------------- The quote's payment table ------------------------- */

const quotePaymentRowSchema = z.object({
  // Set for a row that already exists, so a re-save updates it in place.
  id: z.string().trim().min(1).optional(),
  // The editor's handle for the row, echoed back so a row created by this
  // save can be told its stored id without relying on array position.
  uid: z.number().int().optional(),
  label: z.string().trim().min(1, "Every payment needs a label").max(120),
  kind: z.enum(["PERCENT", "FIXED", "BALANCE"]),
  percent: z.number().min(0).max(100).nullable(),
  fixedCents: z.number().int().min(0).max(1_000_000_000).nullable(),
  dueOn: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A due date isn't valid")]),
  terms: z.string().trim().max(60).nullable().optional(),
});

// The same shape as a contract's schedule save, minus everything about
// money: a quote takes none, so there is no paid floor to respect, no row
// to settle, and no project budget to refresh.
export async function saveQuotePaymentSchedule(input: {
  quoteId: string;
  paymentTerms: string;
  hidePaymentTable: boolean;
  rows: z.infer<typeof quotePaymentRowSchema>[];
}): Promise<ActionState & { saved?: { uid: number; id: string }[] }> {
  const { organizationId } = await requireSession();

  const parsed = z
    .object({
      quoteId: idSchema,
      paymentTerms: z.string().trim().max(120),
      hidePaymentTable: z.boolean(),
      rows: z.array(quotePaymentRowSchema).max(60),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the payment table" };
  }

  const quote = await prisma.quote.findFirst({
    where: { id: parsed.data.quoteId, organizationId },
    select: {
      id: true,
      lineItems: { select: { quantity: true, unitPriceCents: true, tag: true } },
      payments: { orderBy: { position: "asc" }, select: { id: true } },
    },
  });
  if (!quote) return { error: "Quote not found" };

  // Recomputed here and never taken from the browser: the quote's total is
  // its lines, and nothing about it is stored.
  const totalCents = computeQuoteTotals(quote.lineItems).totalCents;
  const schedule = computeSchedule(parsed.data.rows, totalCents);
  if (schedule.rows.some((row) => row.amountCents < 0)) {
    return { error: "The fixed amounts add up to more than the quote total" };
  }

  const existingIds = new Set(quote.payments.map((row) => row.id));
  const seen = new Set<string>();
  for (const row of parsed.data.rows) {
    if (!row.id) continue;
    // An id from another quote, or one deleted since the page loaded, is
    // not this row — writing it would rewrite someone else's table.
    if (!existingIds.has(row.id) || seen.has(row.id)) {
      return { error: "A row on this table has changed since the page loaded. Reload and try again." };
    }
    seen.add(row.id);
  }

  const saved: { uid: number; id: string }[] = [];

  await prisma.$transaction(async (tx) => {
    await tx.quote.updateMany({
      where: { id: quote.id, organizationId },
      data: {
        paymentTerms: parsed.data.paymentTerms || null,
        hidePaymentTable: parsed.data.hidePaymentTable,
      },
    });

    const removed = [...existingIds].filter((id) => !seen.has(id));
    if (removed.length) {
      await tx.quotePayment.deleteMany({ where: { id: { in: removed }, quoteId: quote.id } });
    }

    for (const [position, row] of schedule.rows.entries()) {
      const source = parsed.data.rows[position];
      const data = {
        label: row.label,
        kind: row.kind,
        percent: row.kind === "PERCENT" ? row.percent : null,
        amountCents: row.amountCents,
        dueOn: row.dueOn ? isoToDate(row.dueOn) : null,
        terms: source?.terms?.trim() || null,
        position,
      };
      if (source?.id) {
        await tx.quotePayment.update({ where: { id: source.id }, data });
        if (source.uid !== undefined) saved.push({ uid: source.uid, id: source.id });
      } else {
        const created = await tx.quotePayment.create({
          data: { ...data, quoteId: quote.id, organizationId },
          select: { id: true },
        });
        if (source?.uid !== undefined) saved.push({ uid: source.uid, id: created.id });
      }
    }
  });

  revalidatePath(`/dashboard/quotes/${quote.id}`);
  return { success: "Payment table saved", saved };
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
