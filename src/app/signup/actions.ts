"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CONTRACT_TEMPLATES } from "@/lib/default-templates";

const signupSchema = z.object({
  companyName: z.string().trim().min(2, "Company name is too short"),
  name: z.string().trim().min(1, "Your name is required"),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  // Nothing sends email yet, so this is the only way to reach an applicant
  // once they've been approved. Required for that reason, not validated
  // beyond a length — phone formats vary too much to reject on a guess.
  phone: z.string().trim().min(7, "Enter a phone number we can reach you on").max(40),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function signup(_prevState: { error?: string }, formData: FormData) {
  const parsed = signupSchema.safeParse({
    companyName: formData.get("companyName"),
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { companyName, name, email, phone, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);
  const base = slugify(companyName) || "workspace";

  // Two people can pick the same company name at the same instant, so the
  // unique constraint — not a pre-flight SELECT — is the source of truth.
  // Retry on a slug collision; surface a duplicate email as a form error.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    try {
      await prisma.organization.create({
        data: {
          name: companyName,
          slug,
          // The gate. Nothing here decides its own status, so a crafted
          // request can't sign itself up as ACTIVE.
          status: "PENDING",
          users: {
            create: { name, email, phone, passwordHash, role: "OWNER" },
          },
          contractTemplates: {
            create: DEFAULT_CONTRACT_TEMPLATES.map((template) => ({
              name: template.name,
              type: template.type,
              description: template.description,
              body: template.body,
            })),
          },
        },
      });
      break;
    } catch (error) {
      const target = String((error as { meta?: { target?: unknown } })?.meta?.target ?? "");
      if ((error as { code?: string })?.code !== "P2002") throw error;
      if (target.includes("email")) {
        return { error: "An account with that email already exists" };
      }
      if (attempt === 4) {
        return { error: "Could not create that workspace. Try a different name." };
      }
    }
  }

  // No sign-in: the account exists but can't be used until it's approved.
  redirect("/signup/submitted");
}
