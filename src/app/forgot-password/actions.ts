"use server";

import { createPasswordReset, RESET_TTL_MINUTES } from "@/lib/password-reset";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { keepFields } from "@/lib/forms";
import { absoluteUrl } from "@/lib/app-url";


export async function requestPasswordReset(
  _prevState: { sent?: boolean; error?: string; kept?: Record<string, string> },
  formData: FormData,
) {
  const email = String(formData.get("email") ?? "").trim();
  const kept = keepFields(formData, ["email"]);

  if (!email) {
    return { error: "Enter the email address you log in with.", kept };
  }

  // Nothing can arrive, so say so rather than claiming an email is coming.
  // The link into this page is hidden when email is off, but a bookmark or
  // a typed address can still get here.
  if (!isEmailConfigured()) {
    return {
      error:
        "Email isn't switched on for this site yet, so a reset link can't be sent. Get in touch and we'll set your password by hand.",
      kept,
    };
  }

  const started = await createPasswordReset(email);

  // No such account, or too many requests in the last hour. Same words,
  // same shape, no clue either way.
  if (!started) return { sent: true };

  const url = await absoluteUrl(`/reset-password/${started.token}`);
  const firstName = started.user.name.split(" ")[0] || "there";

  const result = await sendEmail({
    to: started.user.email,
    subject: "Set a new password",
    text: [
      `Hi ${firstName},`,
      "",
      "Someone asked to set a new password for your Software Connect Brands account.",
      "Open this link to choose one:",
      "",
      url,
      "",
      `The link lasts ${RESET_TTL_MINUTES} minutes and can only be used once.`,
      "If this wasn't you, ignore this email — nothing has changed.",
    ].join("\n"),
    html: [
      `<p>Hi ${firstName},</p>`,
      "<p>Someone asked to set a new password for your Software Connect Brands account.</p>",
      `<p><a href="${url}">Choose a new password</a></p>`,
      `<p>The link lasts ${RESET_TTL_MINUTES} minutes and can only be used once.</p>`,
      "<p>If this wasn't you, ignore this email — nothing has changed.</p>",
    ].join("\n"),
  });

  if (!result.ok) {
    // Worth a line in the logs: a refusal here is nearly always the sending
    // domain not being verified yet, and it is invisible from the screen.
    console.error("[password reset] send failed:", result.error);
  }

  // Still the same answer. Whether the provider accepted it is not the
  // asker's business, and saying otherwise would leak the account's
  // existence just as surely.
  return { sent: true };
}
