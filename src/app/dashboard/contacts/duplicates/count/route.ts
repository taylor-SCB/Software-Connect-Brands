import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { findContactDuplicates } from "@/lib/duplicates";

// The "N possible" badge beside Merge on the list. Fetched by the browser
// after the list has drawn, so it never slows the list down.
export async function GET() {
  const { organizationId } = await requireSession();
  const pairs = await findContactDuplicates(organizationId);
  return NextResponse.json({ count: pairs.length }, { headers: { "Cache-Control": "private, no-store" } });
}
