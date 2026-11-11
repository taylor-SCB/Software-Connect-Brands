"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

// "43 new leads nobody owns · Take 10" on Up next (BDR redesign, Nov 11,
// 2026; decision 18). A claim a person makes, never automatic. It works
// like Bulk Assign's "Assign to me" (assignRecords), with two guards that
// matter here because two reps may tap Take 10 at the same moment: only
// leads still nobody's are taken, and Undo gives back only the ones this
// person still holds. One statement each; updatedAt is left alone, like
// Bulk Assign, so the lists don't reshuffle.

const idsSchema = z.array(z.string().trim().min(1).max(60)).min(1).max(50);

export async function takeUnownedLeads(ids: string[]): Promise<{ error: string } | { taken: string[] }> {
  const { organizationId, userId } = await requireSession();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { error: "Reload the page and try again." };
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Contact" SET "ownerId" = ${userId}
     WHERE "organizationId" = ${organizationId} AND id = ANY(${parsed.data}) AND "ownerId" IS NULL
     RETURNING id`;
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/contacts", "layout");
  if (rows.length === 0) return { error: "Someone else took those first." };
  return { taken: rows.map((row) => row.id) };
}

export async function giveBackLeads(ids: string[]): Promise<{ error?: string; returned?: number }> {
  const { organizationId, userId } = await requireSession();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { error: "Reload the page and try again." };
  const returned = await prisma.$executeRaw`
    UPDATE "Contact" SET "ownerId" = NULL
     WHERE "organizationId" = ${organizationId} AND id = ANY(${parsed.data}) AND "ownerId" = ${userId}`;
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/contacts", "layout");
  return { returned };
}
