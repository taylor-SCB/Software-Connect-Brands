import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { loadComposerSetup } from "@/lib/email-marketing";

// What the Email window needs when it opens: today's count, the
// templates and files to offer, and anything that blocks sending.
// Fetched on open rather than shipped with every page that has a button.
export async function GET() {
  const { organizationId, userId } = await requireSession();
  const setup = await loadComposerSetup(organizationId, userId);
  return NextResponse.json(setup, { headers: { "Cache-Control": "private, no-store" } });
}
