"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import {
  checkArtwork,
  finishArtwork,
  removeArtwork,
  startArtwork,
  sweepUnusedArtwork,
  updateArtwork,
  type ArtworkOwner,
} from "@/lib/artwork";

// The apparel pack (Nov 12, 2026): a customer's artwork, from their company
// page or from the proof sheet. Anyone signed in, like product pictures;
// each is scoped to the workspace in the library, which also re-checks the
// apparel switch.

const id = z.string().trim().min(1).max(60);
const ownerSchema = z.union([z.object({ companyId: id }), z.object({ contactId: id })]);

function refresh(owner: ArtworkOwner | null) {
  if (owner?.companyId) revalidatePath(`/dashboard/companies/${owner.companyId}`);
  if (owner?.contactId) revalidatePath(`/dashboard/contacts/${owner.contactId}`);
}

export async function startArtworkUpload(input: { owner: ArtworkOwner; previewType: string; printName?: string | null; printSize?: number | null }) {
  const { organizationId, userId } = await requireSession();
  const parsed = z
    .object({
      owner: ownerSchema,
      previewType: z.string().max(40),
      printName: z.string().max(300).nullable().optional(),
      printSize: z.number().nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "That artwork couldn't be read." };
  return startArtwork(organizationId, userId, parsed.data as Parameters<typeof startArtwork>[2]);
}

const finishSchema = z.object({
  owner: ownerSchema,
  tickets: z.array(z.string().max(4000)).min(3).max(4),
  name: z.string().max(200),
  inkNote: z.string().max(400).nullable().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  printName: z.string().max(300).nullable().optional(),
});

export async function finishArtworkUpload(input: z.input<typeof finishSchema>) {
  const { organizationId, userId } = await requireSession();
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { error: "That artwork couldn't be read. Add it again." };
  const result = await finishArtwork(organizationId, userId, parsed.data);
  if ("ok" in result) refresh(parsed.data.owner as ArtworkOwner);
  return result;
}

// Asked right after an upload, on its own so the tile shows at once.
export async function checkArtworkNow(artworkId: string) {
  const { organizationId, userId } = await requireSession();
  if (!id.safeParse(artworkId).success) return { error: "Reload the page." };
  return checkArtwork(organizationId, userId, artworkId);
}

export async function renameArtwork(artworkId: string, name: string, inkNote: string | null) {
  const { organizationId } = await requireSession();
  const parsed = z
    .object({ artworkId: id, name: z.string().max(200), inkNote: z.string().max(400).nullable() })
    .safeParse({ artworkId, name, inkNote });
  if (!parsed.success) return { error: "Reload the page." };
  return updateArtwork(organizationId, parsed.data.artworkId, parsed.data);
}

export async function removeArtworkAction(artworkId: string) {
  const { organizationId } = await requireSession();
  if (!id.safeParse(artworkId).success) return { error: "Reload the page." };
  const result = await removeArtwork(organizationId, artworkId);
  await sweepUnusedArtwork(organizationId);
  return result;
}
