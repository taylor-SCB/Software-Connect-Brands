"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ACCOUNT_TYPES } from "@/lib/account-types";
import { keepFields } from "@/lib/forms";
import { createWorkspace } from "@/lib/workspaces";

const signupSchema = z.object({
  // One line, like Create Account's: the name goes in email subjects and,
  // for a supplier, in every other workspace's supplier pickers.
  companyName: z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(2, "Company name is too short").max(120, "That company name is too long")),
  // What kind of company this is. A page opened before the choice existed
  // posts nothing, and reads as a Business / Vendor — the operator sees
  // the type when approving and can change it.
  accountType: z.enum(ACCOUNT_TYPES, { message: "Pick what kind of company you are" }),
  name: z.string().trim().min(1, "Your name is required"),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")),
  // Nothing sends email yet, so this is the only way to reach an applicant
  // once they've been approved. Required for that reason, not validated
  // beyond a length — phone formats vary too much to reject on a guess.
  phone: z.string().trim().min(7, "Enter a phone number we can reach you on").max(40),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type SignupState = { error?: string; kept?: Record<string, string> };

export async function signup(_prevState: SignupState, formData: FormData): Promise<SignupState> {
  // Everything typed comes back on a refusal except the password: React
  // empties the form when the action finishes, refused or not.
  const kept = keepFields(formData, ["companyName", "accountType", "name", "email", "phone"]);
  const parsed = signupSchema.safeParse({
    companyName: formData.get("companyName"),
    accountType: formData.get("accountType") ?? "BUSINESS",
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input", kept };
  }

  const { companyName, accountType, name, email, phone, password } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);

  const created = await createWorkspace({
    companyName,
    accountType,
    // The gate. Nothing here decides its own status, so a crafted
    // request can't sign itself up as ACTIVE.
    status: "PENDING",
    owner: { name, email, phone, passwordHash },
  });
  if (!created.ok) {
    return {
      error:
        created.reason === "email"
          ? "An account with that email already exists"
          : "Could not create that workspace. Try a different name.",
      kept,
    };
  }

  // No sign-in: the account exists but can't be used until it's approved.
  redirect("/signup/submitted");
}
