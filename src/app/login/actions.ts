"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { signIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const STATUS_MESSAGES: Record<string, string> = {
  PENDING:
    "Your workspace is still waiting to be approved. We'll be in touch once it's open.",
  PAUSED:
    "This workspace is paused. Get in touch and we'll get you back up and running.",
  REJECTED: "This workspace isn't active. Get in touch if that's a mistake.",
};

// A sign-in can fail because the password is wrong or because the workspace
// isn't open yet, and those need different wording — someone waiting on
// approval should not be left retrying a password that was always correct.
// Working it out here rather than in `authorize` keeps the distinction out
// of the credentials flow, where a thrown custom error does not survive
// NextAuth's serialization and takes the whole page down with it.
async function explainFailure(email: unknown, password: unknown) {
  const generic = "Invalid email or password";
  if (typeof email !== "string" || typeof password !== "string") return generic;

  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { passwordHash: true, organization: { select: { status: true } } },
  });
  if (!user) return generic;

  // The password still has to be right. Otherwise anyone typing an email
  // address could learn which businesses have accounts and what state
  // they're in.
  if (!(await bcrypt.compare(password, user.passwordHash))) return generic;

  return STATUS_MESSAGES[user.organization.status] ?? generic;
}

export async function login(_prevState: { error?: string }, formData: FormData) {
  const email = formData.get("email");
  const password = formData.get("password");

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
    return { error: undefined };
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: await explainFailure(email, password) };
    }
    // A successful sign-in redirects by throwing; that must propagate.
    throw error;
  }
}
