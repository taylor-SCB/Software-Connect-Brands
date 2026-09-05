"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/session";
import { parseForm, optionalText, type ActionState } from "@/lib/forms";

const brandingSchema = z.object({
  name: z.string().trim().min(2, "Company name is too short").max(120),
  // The logo is rendered in an <img> on customer-facing documents, so
  // only http(s) is allowed — `javascript:` and huge `data:` URLs are
  // rejected rather than embedded in a quote.
  logoUrl: z
    .union([
      z.literal(""),
      z
        .url("Enter a valid image URL")
        .refine(
          (value) => /^https?:\/\//i.test(value),
          "Logo URL must start with http:// or https://",
        ),
    ])
    .optional(),
  primaryColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Enter a color as a 6-digit hex code, e.g. #6366f1"),
});

export async function updateBranding(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireAdminSession();
  if (!session.allowed) {
    return { error: "Only owners and admins can change branding" };
  }

  const parsed = parseForm(brandingSchema, {
    name: formData.get("name"),
    logoUrl: formData.get("logoUrl") ?? undefined,
    primaryColor: formData.get("primaryColor"),
  });
  if (!parsed.ok) return { error: parsed.error };

  await prisma.organization.update({
    where: { id: session.organizationId },
    data: {
      name: parsed.data.name,
      logoUrl: optionalText(formData.get("logoUrl")),
      primaryColor: parsed.data.primaryColor.toLowerCase(),
    },
  });

  // The layout renders the brand color and name, so the whole dashboard
  // subtree has to be revalidated, not just this page.
  revalidatePath("/dashboard", "layout");
  return { success: "Branding saved" };
}
