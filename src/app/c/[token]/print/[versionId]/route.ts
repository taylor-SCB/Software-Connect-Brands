import { contractPrintFile } from "@/lib/proofs";
import { downloadHeaders } from "@/lib/artwork";

// The apparel pack (Nov 12, 2026): the printer's file behind an approved
// proof on a purchase order, for whoever holds the order's link. Only a
// money-out contract that is out or signed, only a version it carries that
// was approved, only while the workspace is active. Always a download.
export async function GET(request: Request, { params }: { params: Promise<{ token: string; versionId: string }> }) {
  const { token, versionId } = await params;
  const position = Number(new URL(request.url).searchParams.get("p") ?? "0");
  if (!token || !versionId || versionId.length > 60 || !Number.isInteger(position) || position < 0 || position > 9) {
    return new Response("Not found", { status: 404 });
  }
  const file = await contractPrintFile(token, versionId, position);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(file.body, { headers: downloadHeaders(file.name, file.size) });
}
