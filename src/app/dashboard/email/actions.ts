"use server";

import { z } from "zod";
import { requireSession } from "@/lib/session";
import { oneToOneLogBody, sendOneToOneEmail } from "@/lib/email-marketing";
import { logActivity } from "@/app/dashboard/contacts/actions";
import type { FollowUpSeed } from "@/lib/logging";

export type OneToOneResult =
  | { error: string }
  | { success: string; batchId?: string; followUp?: FollowUpSeed; logError?: string };

const schema = z.object({
  contactId: z.string().min(1).max(64),
  to: z.string().min(3).max(320),
  subject: z.string().max(1000),
  body: z.string().max(50_000),
});

// The one-to-one Email from a contact's page (decision 16): send it, then
// log it as the rep's EMAIL touch with outcome Sent through logActivity,
// the same door the "How did it go?" sheet uses, so the calendar entry,
// Attempted on the ladder and the follow-up box all behave as for any
// logged email. No Undo: an email that went out can't be taken back.
export async function sendContactEmail(input: { contactId: string; to: string; subject: string; body: string }): Promise<OneToOneResult> {
  const session = await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: "That email didn't make sense. Reload and try again." };

  const sent = await sendOneToOneEmail(session, parsed.data);
  if (!sent.ok) return { error: sent.error };

  const form = new FormData();
  form.set("contactId", parsed.data.contactId);
  form.set("type", "EMAIL");
  form.set("outcome", "SENT");
  form.set("body", oneToOneLogBody(sent.subject, sent.body));
  const logged = await logActivity({}, form);
  if (logged.error) {
    // Sent, but the line didn't land: say both, so nobody sends it twice.
    return { success: `Sent to ${sent.to}`, logError: `It went out, but it couldn't be logged: ${logged.error}` };
  }
  return { success: `Sent to ${sent.to} · logged as an email`, batchId: logged.batchId, followUp: logged.followUp };
}
