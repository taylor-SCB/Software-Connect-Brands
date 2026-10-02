import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { scanDuplicates, storedDuplicateCount } from "@/lib/duplicates";

// The "N possible" badge beside Merge: what the radar last found, read
// from one row. ?fresh=1 (the note at the end of an import) runs the full
// check and saves its number.
export async function GET(request: Request) {
  const { organizationId } = await requireSession();
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const count = fresh ? (await scanDuplicates(organizationId, "contact")).length : await storedDuplicateCount(organizationId, "contact");
  return NextResponse.json({ count }, { headers: { "Cache-Control": "private, no-store" } });
}
