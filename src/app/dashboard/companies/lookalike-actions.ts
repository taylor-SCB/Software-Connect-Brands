"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { pairKey } from "@/lib/lookalikes";

// "Not the same business" (Nov 13, 2026): remembered for the pair, so the
// company page stops suggesting them and Find duplicates hides a group
// that is only those two. As for people: anyone signed in, with Undo.

const idSchema = z.string().trim().min(1).max(100);

async function pairOf(organizationId: string, companyId: string, otherId: string) {
  const a = idSchema.safeParse(companyId);
  const b = idSchema.safeParse(otherId);
  if (!a.success || !b.success || a.data === b.data) return null;
  return { ids: [a.data, b.data] as const, key: pairKey(a.data, b.data) };
}

function refresh(ids: readonly string[]) {
  for (const id of ids) revalidatePath(`/dashboard/companies/${id}`);
  revalidatePath("/dashboard/companies/duplicates");
}

export async function notTheSameBusiness(companyId: string, otherId: string): Promise<{ error?: string; success?: string }> {
  const { organizationId, userId } = await requireSession();
  const pair = await pairOf(organizationId, companyId, otherId);
  if (!pair) return { error: "Those two aren't valid" };
  const found = await prisma.company.count({ where: { organizationId, id: { in: [...pair.ids] } } });
  if (found !== 2) return { error: "One of them is no longer here" };
  const [aId, bId] = pair.key;
  await prisma.duplicateDismissal.upsert({
    where: { organizationId_kind_aId_bId: { organizationId, kind: "company", aId, bId } },
    create: { organizationId, kind: "company", aId, bId, userId },
    update: {},
  });
  refresh(pair.ids);
  return { success: "Got it: not the same business" };
}

export async function undoNotTheSameBusiness(companyId: string, otherId: string): Promise<{ error?: string }> {
  const { organizationId } = await requireSession();
  const pair = await pairOf(organizationId, companyId, otherId);
  if (!pair) return { error: "Those two aren't valid" };
  const [aId, bId] = pair.key;
  await prisma.duplicateDismissal.deleteMany({ where: { organizationId, kind: "company", aId, bId } });
  refresh(pair.ids);
  return {};
}
