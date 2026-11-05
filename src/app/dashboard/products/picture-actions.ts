"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import {
  finishProductImage,
  makeMainPicture,
  removeProductImage,
  setPictureColor,
  startProductImage,
  sweepUnusedPictures,
} from "@/lib/product-images";

// A product's Pictures card (Release 3b). Anyone signed in, like every
// other Products action. Each is scoped to the workspace in the library.

const id = z.string().trim().min(1).max(60);

function refresh(productId: string) {
  revalidatePath(`/dashboard/products/${productId}`);
  revalidatePath("/dashboard/products");
}

export async function startPicture(productId: string, type: string) {
  const { organizationId, userId } = await requireSession();
  const parsed = z.object({ productId: id, type: z.string().max(40) }).safeParse({ productId, type });
  if (!parsed.success) return { error: "That picture couldn't be read." };
  return startProductImage(organizationId, userId, parsed.data.productId, parsed.data.type);
}

const finishSchema = z.object({
  productId: id,
  tickets: z.array(z.string().max(4000)).length(3),
  colorOptionId: z.string().max(60).nullable().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
});

export async function finishPicture(input: z.input<typeof finishSchema>) {
  const { organizationId, userId } = await requireSession();
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { error: "That picture couldn't be read. Add it again." };
  const result = await finishProductImage(organizationId, userId, parsed.data);
  if ("ok" in result) refresh(parsed.data.productId);
  return result;
}

export async function removePicture(productId: string, imageId: string) {
  const { organizationId } = await requireSession();
  if (!id.safeParse(productId).success || !id.safeParse(imageId).success) return { error: "Reload the page." };
  const result = await removeProductImage(organizationId, imageId);
  await sweepUnusedPictures(organizationId);
  refresh(productId);
  return result;
}

export async function makePictureMain(productId: string, imageId: string) {
  const { organizationId } = await requireSession();
  if (!id.safeParse(productId).success || !id.safeParse(imageId).success) return { error: "Reload the page." };
  const result = await makeMainPicture(organizationId, imageId);
  refresh(productId);
  return result;
}

export async function colorPicture(productId: string, imageId: string, colorOptionId: string | null) {
  const { organizationId } = await requireSession();
  if (!id.safeParse(productId).success || !id.safeParse(imageId).success) return { error: "Reload the page." };
  if (colorOptionId !== null && !id.safeParse(colorOptionId).success) return { error: "Reload the page." };
  const result = await setPictureColor(organizationId, imageId, colorOptionId);
  refresh(productId);
  return result;
}
