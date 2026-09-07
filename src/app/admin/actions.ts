"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin } from "@/lib/session";

const decisionSchema = z.object({
  organizationId: z.string().min(1),
  status: z.enum(["ACTIVE", "PAUSED", "REJECTED"]),
});

export async function setOrganizationStatus(formData: FormData) {
  // Every action re-checks operator access on the server. The buttons are
  // only rendered for an operator, but a hidden button is not a permission
  // check — a form post is trivial to replay.
  await requireSuperAdmin();

  const parsed = decisionSchema.safeParse({
    organizationId: formData.get("organizationId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return;

  await prisma.organization.update({
    where: { id: parsed.data.organizationId },
    data: { status: parsed.data.status, reviewedAt: new Date() },
  });

  revalidatePath("/admin");
}

export async function deleteOrganization(formData: FormData) {
  await requireSuperAdmin();

  const organizationId = String(formData.get("organizationId") ?? "");
  const confirmName = String(formData.get("confirmName") ?? "").trim();
  if (!organizationId) return;

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  if (!organization) return;

  // Deleting cascades to every contact, quote and signed contract the
  // business has. Typing the name is the only thing standing between a
  // misplaced click and unrecoverable customer data.
  if (confirmName !== organization.name) return;

  await prisma.organization.delete({ where: { id: organizationId } });
  revalidatePath("/admin");
}
