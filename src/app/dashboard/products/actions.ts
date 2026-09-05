"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { parseForm, optionalText, type ActionState } from "@/lib/forms";
import { dollarsToCents } from "@/lib/format";
import { LINE_ITEM_TAGS } from "@/lib/constants";

const productSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(160),
  description: z.string().trim().max(2000).optional(),
  sku: z.string().trim().max(60).optional(),
  defaultTag: z.enum(LINE_ITEM_TAGS),
  active: z.union([z.literal("on"), z.literal("")]).optional(),
});

export async function createProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const parsed = parseForm(productSchema, {
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    sku: formData.get("sku") ?? undefined,
    defaultTag: formData.get("defaultTag"),
    active: formData.get("active") ?? "",
  });
  if (!parsed.ok) return { error: parsed.error };

  await prisma.product.create({
    data: {
      organizationId,
      name: parsed.data.name,
      description: optionalText(formData.get("description")) ?? "",
      sku: optionalText(formData.get("sku")),
      unitPriceCents: dollarsToCents(formData.get("unitPrice")),
      defaultTag: parsed.data.defaultTag,
      active: formData.get("active") === "on",
    },
  });

  revalidatePath("/dashboard/products");
  redirect("/dashboard/products");
}

export async function updateProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireSession();

  const id = z.string().trim().min(1).safeParse(formData.get("productId"));
  if (!id.success) return { error: "Missing product reference" };

  const parsed = parseForm(productSchema, {
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    sku: formData.get("sku") ?? undefined,
    defaultTag: formData.get("defaultTag"),
    active: formData.get("active") ?? "",
  });
  if (!parsed.ok) return { error: parsed.error };

  const result = await prisma.product.updateMany({
    where: { id: id.data, organizationId },
    data: {
      name: parsed.data.name,
      description: optionalText(formData.get("description")) ?? "",
      sku: optionalText(formData.get("sku")),
      unitPriceCents: dollarsToCents(formData.get("unitPrice")),
      defaultTag: parsed.data.defaultTag,
      active: formData.get("active") === "on",
    },
  });
  if (result.count === 0) return { error: "Product not found" };

  revalidatePath("/dashboard/products");
  return { success: "Product saved" };
}

export async function deleteProduct(formData: FormData) {
  const { organizationId } = await requireSession();
  const id = z.string().trim().min(1).safeParse(formData.get("productId"));
  if (!id.success) return;

  // Line items keep their copied name/price (productId is SetNull), so
  // deleting a product never rewrites a quote that already went out.
  await prisma.product.deleteMany({ where: { id: id.data, organizationId } });

  revalidatePath("/dashboard/products");
  redirect("/dashboard/products");
}
