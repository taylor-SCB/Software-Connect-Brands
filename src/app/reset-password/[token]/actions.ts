"use server";

import { completePasswordReset, MIN_PASSWORD_LENGTH } from "@/lib/password-reset";

const DEAD_LINK =
  "That link has already been used or has expired. Ask for a new one.";

export async function setNewPassword(
  _prevState: { error?: string; done?: boolean },
  formData: FormData,
) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  // Checked before the link is spent, so a typo does not cost someone
  // their one use of it and send them back to the start.
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password !== confirm) {
    return { error: "The two passwords don't match." };
  }

  const result = await completePasswordReset(token, password);
  if (!result.ok) {
    return { error: result.reason === "weak" ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : DEAD_LINK };
  }

  // Deliberately not signing them in here. Typing the new password once on
  // the login screen is what makes it stick in someone's memory, and it
  // proves the change actually took.
  return { done: true };
}
