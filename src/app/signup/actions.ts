"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { signIn } from "@/lib/auth";

const signupSchema = z.object({
  companyName: z.string().trim().min(2, "Company name is too short"),
  name: z.string().trim().min(1, "Your name is required"),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "An account with that email already exists" };
  }

  const baseSlug = slugify(companyName) || "org";
  let slug = baseSlug;
  let attempt = 0;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.organization.create({
    data: {
      name: companyName,
      slug,
      users: {
        create: {
          name,
          email,
          passwordHash,
          role: "OWNER",
        },
      },
    },
  });

  await signIn("credentials", {
    email,
    password,
    redirectTo: "/dashboard",
  });

  return { error: undefined };
}
