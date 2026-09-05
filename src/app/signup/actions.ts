"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { signIn } from "@/lib/auth";
import { DEFAULT_CONTRACT_TEMPLATES } from "@/lib/default-templates";

const signupSchema = z.object({
  companyName: z.string().trim().min(2, "Company name is too short"),
  name: z.string().trim().min(1, "Your name is required"),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
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
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { companyName, name, email, password } = parsed.data;
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
          users: {
            create: { name, email, passwordHash, role: "OWNER" },
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

  // Throws a redirect on success, so nothing below runs.
  await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  return { error: undefined };
}
