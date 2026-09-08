import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// Streams an uploaded ratesheet file back to the workspace that owns it.
// This is the one place the Bytes column is read (see the global omit in
// src/lib/prisma.ts).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { organizationId } = await requireSession();

  const file = await prisma.linkedRatesheet.findFirst({
    where: { id, organizationId },
    select: { data: true, fileName: true, mimeType: true, sizeBytes: true },
  });
  if (!file) return new Response("Not found", { status: 404 });

  // RFC 5987 encoding keeps non-ASCII file names intact; the plain
  // fallback keeps older clients happy.
  const ascii = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  const encoded = encodeURIComponent(file.fileName);

  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
    },
  });
}
