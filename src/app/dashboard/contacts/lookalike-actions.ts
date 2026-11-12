"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { pairKey } from "@/lib/lookalikes";

// "Not the same person" (AI release A, Nov 12, 2026): remembered for the
// pair, so the contact page stops suggesting them and Find duplicates
// hides a group that is only those two. Anyone signed in may say so, as
// anyone may merge; "Undo" takes it back.

const idSchema = z.string().trim().min(1).max(100);

export async function notTheSamePerson(contactId: string, otherId: string): Promise<{ error?: string; success?: string }> {
  const { organizationId, userId } = await requireSession();
  const a = idSchema.safeParse(contactId);
  const b = idSchema.safeParse(otherId);
  if (!a.success || !b.success || a.data === b.data) return { error: "Those two aren't valid" };
  const found = await prisma.contact.count({ where: { organizationId, id: { in: [a.data, b.data] } } });
  if (found !== 2) return { error: "One of them is no longer here" };
  const [aId, bId] = pairKey(a.data, b.data);
  await prisma.duplicateDismissal.upsert({
    where: { organizationId_kind_aId_bId: { organizationId, kind: "contact", aId, bId } },
    create: { organizationId, kind: "contact", aId, bId, userId },
    update: {},
  });
  revalidatePath(`/dashboard/contacts/${a.data}`);
  revalidatePath(`/dashboard/contacts/${b.data}`);
  revalidatePath("/dashboard/contacts/duplicates");
  return { success: "Got it: not the same person" };
}

export async function undoNotTheSamePerson(contactId: string, otherId: string): Promise<{ error?: string }> {
  const { organizationId } = await requireSession();
  const a = idSchema.safeParse(contactId);
  const b = idSchema.safeParse(otherId);
  if (!a.success || !b.success) return { error: "Those two aren't valid" };
  const [aId, bId] = pairKey(a.data, b.data);
  await prisma.duplicateDismissal.deleteMany({ where: { organizationId, kind: "contact", aId, bId } });
  revalidatePath(`/dashboard/contacts/${a.data}`);
  revalidatePath(`/dashboard/contacts/${b.data}`);
  revalidatePath("/dashboard/contacts/duplicates");
  return {};
}
