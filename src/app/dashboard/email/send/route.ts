import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { sendMarketingEmails } from "@/lib/email-marketing";
import { DAILY_EMAIL_LIMIT, MAX_ATTACHMENTS } from "@/lib/email-fields";

// Forty individually addressed emails, spaced to stay under the email
// provider's rate limit, take about half a minute. 60 is the most the
// other long routes here (the PDFs) ask for.
export const maxDuration = 60;

const schema = z.object({
  contactIds: z.array(z.string().min(1).max(64)).max(DAILY_EMAIL_LIMIT),
  subject: z.string().max(1000),
  body: z.string().max(50_000),
  templateId: z.string().max(64).nullable().default(null),
  fileIds: z.array(z.string().min(1).max(64)).max(MAX_ATTACHMENTS).default([]),
});

export async function POST(request: Request) {
  const session = await requireSession();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "That send didn't make sense. Reload and try again." }, { status: 400 });
  }
  const outcome = await sendMarketingEmails(session, parsed.data);
  return NextResponse.json(outcome, { headers: { "Cache-Control": "private, no-store" } });
}
