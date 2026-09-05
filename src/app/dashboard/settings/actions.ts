"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

const brandingSchema = z.object({
  name: z.string().trim().min(2, "Company name is too short"),
  logoUrl: z.string().trim().url().optional().or(z.literal("")),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Enter a color as a hex code, e.g. #4f46e5"),
});

export async function updateBranding(_prevState: { error?: string; success?: boolean }, formData: FormData) {
  const { organizationId } = await requireSession();

  const parsed = brandingSchema.safeParse({
    name: formData.get("name"),
    logoUrl: formData.get("logoUrl"),
    primaryColor: formData.get("primaryColor"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { name, logoUrl, primaryColor } = parsed.data;

  await prisma.organization.update({
    where: { id: organizationId },
    data: { name, logoUrl: logoUrl || null, primaryColor },
  });

  revalidatePath("/dashboard", "layout");
  return { success: true };
}
